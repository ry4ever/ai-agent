#!/usr/bin/env node
/**
 * MCP Server Wrapper
 *
 * Exposes all Agent Services Platform endpoints as MCP tools.
 * This lets Claude agents (and any MCP-compatible client) discover and call
 * services without needing an x402-native client — dramatically expanding
 * the addressable market beyond crypto-native agents.
 *
 * Architecture:
 *   MCP Client (Claude, Cursor, VS Code, ...)
 *     → MCP tools (this file, run over stdio)
 *       → HTTP calls to the platform (with x402 payment auto-generated per call)
 *         → paywalled API endpoints
 *
 * Runs against the live production API by default. Override with PLATFORM_URL.
 *
 * Payment:
 *   Set MCP_PRIVATE_KEY to a wallet private key with USDC on Base.
 *   The server automatically constructs x402 payments for each paid request.
 *   Without a key, paid endpoints return 402 with payment instructions.
 *
 * Usage:
 *   npx agent-services-platform          # after npm publish
 *   npm run mcp                          # local dev (ts-node)
 *   node dist/mcp/server.js              # built
 */

import 'dotenv/config';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { MCP_TOOLS as TOOLS } from './tools';

const PLATFORM_URL = process.env.PLATFORM_URL ?? 'https://agents.aiscale.pro';
const PRIVATE_KEY = process.env.MCP_PRIVATE_KEY ?? '';
const AGENT_ADDRESS = process.env.MCP_AGENT_ADDRESS ?? '0x0000000000000000000000000000000000000000';

// ---------------------------------------------------------------------------
// HTTP client: auto-payment when MCP_PRIVATE_KEY is set
// ---------------------------------------------------------------------------

type FetchLike = typeof fetch;
let httpClient: FetchLike = fetch;

async function setupPaymentClient(): Promise<string | null> {
  if (!PRIVATE_KEY) return null;
  const { wrapFetchWithPayment } = await import('@x402/fetch');
  const { x402Client } = await import('@x402/core/client');
  const { registerExactEvmScheme } = await import('@x402/evm/exact/client');
  const { privateKeyToAccount } = await import('viem/accounts');

  const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);
  const client = new x402Client();
  registerExactEvmScheme(client, { signer: account });
  httpClient = wrapFetchWithPayment(fetch, client);
  return account.address;
}

async function apiGet(path: string, params?: Record<string, string>): Promise<unknown> {
  const url = new URL(`${PLATFORM_URL}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, v);
    }
  }
  const res = await httpClient(url.toString(), {
    headers: { 'x-agent-address': AGENT_ADDRESS },
  });
  return handleResponse(res);
}

async function apiPost(path: string, body: Record<string, unknown>): Promise<unknown> {
  const res = await httpClient(`${PLATFORM_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-agent-address': AGENT_ADDRESS,
    },
    body: JSON.stringify(body),
  });
  return handleResponse(res);
}

async function handleResponse(res: Response): Promise<unknown> {
  if (!res.ok) {
    const text = await res.text();
    let data: unknown = text;
    try { data = JSON.parse(text); } catch { /* keep as text */ }
    throw { status: res.status, data, message: `HTTP ${res.status}` };
  }
  return res.json();
}


// ---------------------------------------------------------------------------
// Tool call handlers
// ---------------------------------------------------------------------------

async function callTool(
  name: string,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  try {
    let response: unknown;

    switch (name) {
      case 'get_sentiment': {
        response = await apiGet(`/api/v1/sentiment/${encodeURIComponent(String(args.ticker))}`);
        break;
      }
      case 'get_company_profile': {
        response = await apiGet(`/api/v1/company/${encodeURIComponent(String(args.domain))}`);
        break;
      }
      case 'enrich_email': {
        response = await apiGet(`/api/v1/enrich/email/${encodeURIComponent(String(args.email))}`);
        break;
      }
      case 'get_news_summary': {
        response = await apiGet('/api/v1/news/summary', { q: String(args.query) });
        break;
      }
      case 'extract_structured_data': {
        response = await apiPost('/api/v1/extract', {
          url: args.url,
          html: args.html,
        });
        break;
      }
      case 'analyze_contract': {
        response = await apiPost('/api/v1/analyze/contract', {
          url: args.url,
          text: args.text,
          filename: args.filename,
        });
        break;
      }
      case 'review_code': {
        response = await apiPost('/api/v1/review/code', {
          code: args.code,
          language: args.language,
          filename: args.filename,
          context: args.context,
        });
        break;
      }
      case 'synthesize_research': {
        response = await apiPost('/api/v1/research', {
          question: args.question,
          depth: args.depth ?? 'standard',
        });
        break;
      }
      case 'list_services': {
        response = await apiGet('/.well-known/agent-services');
        break;
      }
      default:
        return {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        };
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(response, null, 2) }],
    };
  } catch (err) {
    const e = err as { status?: number; data?: unknown; message: string };

    if (e.status === 402) {
      const paymentInfo = e.data;
      return {
        content: [
          {
            type: 'text',
            text: [
              `Payment required to access this service.`,
              ``,
              `Payment details:`,
              JSON.stringify(paymentInfo, null, 2),
              ``,
              `To pay automatically, set MCP_PRIVATE_KEY in your MCP config to a wallet`,
              `private key with USDC on Base.`,
              ``,
              `Get test USDC: https://faucet.circle.com/ (Base Sepolia)`,
              `Buy USDC on Base: https://bridge.base.org`,
            ].join('\n'),
          },
        ],
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: `Error calling ${name}: ${e.status ?? 'network error'} — ${e.message}`,
        },
      ],
    };
  }
}

// ---------------------------------------------------------------------------
// MCP Server bootstrap
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const walletAddress = await setupPaymentClient();

  const server = new Server(
    {
      name: 'agent-services-platform',
      version: process.env.npm_package_version ?? '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    return callTool(name, (args ?? {}) as Record<string, unknown>);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log to stderr so it doesn't interfere with MCP stdio protocol
  process.stderr.write(
    `[MCP] Agent Services Platform server started\n` +
      `[MCP] Platform URL: ${PLATFORM_URL}\n` +
      `[MCP] Payment: ${walletAddress ? `enabled (wallet: ${walletAddress})` : 'disabled (set MCP_PRIVATE_KEY to enable)'}\n` +
      `[MCP] Tools available: ${TOOLS.map((t) => t.name).join(', ')}\n`
  );
}

main().catch((err) => {
  process.stderr.write(`[MCP] Fatal error: ${err}\n`);
  process.exit(1);
});
