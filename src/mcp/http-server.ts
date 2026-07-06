/**
 * MCP Streamable HTTP Transport — exposes the same 9 tools as the stdio
 * MCP server over HTTP at POST /mcp.
 *
 * This enables:
 *   - Smithery listing (server scanning via HTTP)
 *   - Remote MCP clients connecting directly
 *   - Any MCP-compatible client without npm install
 *
 * Uses stateless mode (no session tracking) — each request is independent.
 */

import { randomUUID } from 'crypto';
import { Request, Response } from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';

const PLATFORM_URL = process.env.PLATFORM_URL ?? process.env.AGENT_URL ?? `http://localhost:${process.env.PORT ?? '3000'}`;

// ---------------------------------------------------------------------------
// Tool definitions (mirrors src/mcp/server.ts)
// ---------------------------------------------------------------------------

const TOOLS: Tool[] = [
  {
    name: 'get_sentiment',
    description:
      'Get real-time sentiment score (-1 to 1) for a stock ticker. ' +
      'Costs $0.002 USDC per call.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        ticker: { type: 'string', description: 'Stock ticker (e.g. AAPL, TSLA)' },
      },
      required: ['ticker'],
    },
  },
  {
    name: 'get_company_profile',
    description:
      'Company profile by domain. Returns name, industry, employees, funding, tech stack. ' +
      'Costs $0.005 USDC per call.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        domain: { type: 'string', description: 'Company domain (e.g. stripe.com)' },
      },
      required: ['domain'],
    },
  },
  {
    name: 'enrich_email',
    description:
      "Email enrichment: full name, company, role, LinkedIn. Costs $0.008 USDC per call.",
    inputSchema: {
      type: 'object' as const,
      properties: {
        email: { type: 'string', description: 'Email (e.g. john@stripe.com)' },
      },
      required: ['email'],
    },
  },
  {
    name: 'get_news_summary',
    description: 'Summarized news for a topic. Costs $0.003 USDC per call.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Topic (e.g. "AI agents")' },
      },
      required: ['query'],
    },
  },
  {
    name: 'extract_structured_data',
    description: 'Extract entities, facts, tables from a URL or HTML. Costs $0.004 USDC per call.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        url: { type: 'string', description: 'URL to extract data from' },
        html: { type: 'string', description: 'Raw HTML (alternative to url)' },
      },
    },
  },
  {
    name: 'analyze_contract',
    description: 'Contract risk analysis (PDF/text). Returns risks, key terms, red flags. Costs $0.10 USDC.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        url: { type: 'string', description: 'URL to PDF/text contract' },
        text: { type: 'string', description: 'Raw contract text' },
      },
    },
  },
  {
    name: 'review_code',
    description: 'Security + quality code review. Costs $0.05 USDC per review.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        code: { type: 'string', description: 'Source code to review' },
        language: { type: 'string', description: 'Programming language' },
      },
      required: ['code'],
    },
  },
  {
    name: 'synthesize_research',
    description: 'Deep research with citations and confidence scores. Costs $0.15 USDC per brief.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        question: { type: 'string', description: 'Research question' },
        depth: { type: 'string', enum: ['quick', 'standard', 'deep'], default: 'standard' },
      },
      required: ['question'],
    },
  },
  {
    name: 'list_services',
    description: 'List all available services with pricing and schemas. Free.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
];

// ---------------------------------------------------------------------------
// Tool call handler — calls the platform API
// ---------------------------------------------------------------------------

async function callTool(
  name: string,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  try {
    let response: unknown;

    switch (name) {
      case 'get_sentiment': {
        const res = await fetch(`${PLATFORM_URL}/api/v1/sentiment/${encodeURIComponent(String(args.ticker))}`);
        response = await handleRes(res);
        break;
      }
      case 'get_company_profile': {
        const res = await fetch(`${PLATFORM_URL}/api/v1/company/${encodeURIComponent(String(args.domain))}`);
        response = await handleRes(res);
        break;
      }
      case 'enrich_email': {
        const res = await fetch(`${PLATFORM_URL}/api/v1/enrich/email/${encodeURIComponent(String(args.email))}`);
        response = await handleRes(res);
        break;
      }
      case 'get_news_summary': {
        const u = new URL(`${PLATFORM_URL}/api/v1/news/summary`);
        u.searchParams.set('q', String(args.query));
        const res = await fetch(u.toString());
        response = await handleRes(res);
        break;
      }
      case 'extract_structured_data': {
        const res = await fetch(`${PLATFORM_URL}/api/v1/extract`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: args.url, html: args.html }),
        });
        response = await handleRes(res);
        break;
      }
      case 'analyze_contract': {
        const res = await fetch(`${PLATFORM_URL}/api/v1/analyze/contract`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: args.url, text: args.text }),
        });
        response = await handleRes(res);
        break;
      }
      case 'review_code': {
        const res = await fetch(`${PLATFORM_URL}/api/v1/review/code`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: args.code, language: args.language }),
        });
        response = await handleRes(res);
        break;
      }
      case 'synthesize_research': {
        const res = await fetch(`${PLATFORM_URL}/api/v1/research`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: args.question, depth: args.depth ?? 'standard' }),
        });
        response = await handleRes(res);
        break;
      }
      case 'list_services': {
        const res = await fetch(`${PLATFORM_URL}/.well-known/agent-services`);
        response = await handleRes(res);
        break;
      }
      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
    }

    return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
  } catch (err) {
    const e = err as { status?: number; data?: unknown; message: string };
    if (e.status === 402) {
      return {
        content: [{
          type: 'text',
          text: [
            'Payment required. Install locally with MCP_PRIVATE_KEY to pay automatically:',
            '  npm install -g agent-services-platform',
            '  MCP_PRIVATE_KEY=0x... aiscale-mcp',
            '',
            'Payment details:',
            JSON.stringify(e.data, null, 2),
          ].join('\n'),
        }],
      };
    }
    return {
      content: [{
        type: 'text',
        text: `Error calling ${name}: ${e.status ?? 'network error'} — ${e.message}`,
      }],
    };
  }
}

async function handleRes(res: globalThis.Response): Promise<unknown> {
  const text = await res.text();
  let data: unknown = text;
  try { data = JSON.parse(text); } catch { /* keep text */ }
  if (!res.ok) throw { status: res.status, data, message: `HTTP ${res.status}` };
  return data;
}

// ---------------------------------------------------------------------------
// Express handler — stateless Streamable HTTP
// ---------------------------------------------------------------------------

export function mcpHttpHandler(): (req: Request, res: Response) => Promise<void> {
  return async (req: Request, res: Response) => {
    // Each request gets its own transport + server instance (stateless mode)
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    const server = new Server(
      { name: 'agent-services-platform', version: '1.1.0' },
      { capabilities: { tools: {} } },
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: TOOLS,
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: toolArgs } = request.params;
      return callTool(name, (toolArgs ?? {}) as Record<string, unknown>);
    });

    server.connect(transport);

    // Let the transport handle the HTTP request
    await transport.handleRequest(req, res, req.body);

    // Clean up after response is sent
    await transport.close();
    await server.close();
  };
}
