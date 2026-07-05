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
 *       → HTTP calls to the platform (with x402 payment header if configured)
 *         → paywalled API endpoints
 *
 * Runs against the live production API by default. Override with PLATFORM_URL.
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
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import axios, { AxiosInstance } from 'axios';

// Defaults to the live production API so the server works out-of-the-box for
// anyone who installs it. Override with PLATFORM_URL to point elsewhere
// (e.g. http://localhost:3000 for local development).
const PLATFORM_URL = process.env.PLATFORM_URL ?? 'https://agents.aiscale.pro';
const PAYMENT_HEADER = process.env.MCP_PAYMENT_HEADER ?? '';
const AGENT_ADDRESS = process.env.MCP_AGENT_ADDRESS ?? '0x0000000000000000000000000000000000000000';

const http: AxiosInstance = axios.create({
  baseURL: PLATFORM_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
    'x-agent-address': AGENT_ADDRESS,
    ...(PAYMENT_HEADER ? { 'X-PAYMENT': PAYMENT_HEADER } : {}),
  },
});

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const TOOLS: Tool[] = [
  {
    name: 'get_sentiment',
    description:
      'Get real-time sentiment score (-1 to 1) for a stock ticker from news and social data. ' +
      'Returns score, bullish/bearish/neutral label, article volume, and source count. ' +
      `Costs $0.002 USDC per call (paid automatically if X-PAYMENT is configured).`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        ticker: {
          type: 'string',
          description: 'Stock ticker symbol (e.g. AAPL, TSLA, ETH)',
        },
      },
      required: ['ticker'],
    },
  },
  {
    name: 'get_company_profile',
    description:
      'Get a company profile by domain name. Returns name, industry, employee count, ' +
      'founded year, location, social links, and tech stack. ' +
      `Costs $0.005 USDC per call.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        domain: {
          type: 'string',
          description: 'Company domain name (e.g. stripe.com, openai.com)',
        },
      },
      required: ['domain'],
    },
  },
  {
    name: 'enrich_email',
    description:
      'Enrich an email address to get the person\'s full name, company, role, ' +
      'LinkedIn URL, and confidence score. ' +
      `Costs $0.008 USDC per call.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        email: {
          type: 'string',
          description: 'Email address to enrich (e.g. john@stripe.com)',
        },
      },
      required: ['email'],
    },
  },
  {
    name: 'get_news_summary',
    description:
      'Get summarized recent news articles for any topic. Returns structured summaries ' +
      'with titles, 1-2 sentence summaries, sources, URLs, and relevance scores. ' +
      `Costs $0.003 USDC per call.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Topic or search query to find news about (e.g. "AI agents", "Base L2")',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'extract_structured_data',
    description:
      'Extract structured data (entities, facts, tables) from any URL or HTML content. ' +
      'Useful for scraping and parsing web pages into clean JSON. ' +
      `Costs $0.004 USDC per call.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        url: {
          type: 'string',
          description: 'URL to fetch and extract data from',
        },
        html: {
          type: 'string',
          description: 'Raw HTML content to extract data from (alternative to url)',
        },
      },
    },
  },
  {
    name: 'analyze_contract',
    description:
      'AI-powered contract analysis. Accepts a PDF URL or raw contract text and returns ' +
      'a structured risk analysis with key terms, risks (low/medium/high/critical), ' +
      'red flags, and a plain-English summary. Overall risk score 1-10. ' +
      `Costs $0.10 USDC per analysis.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        url: {
          type: 'string',
          description: 'URL to a PDF or text contract',
        },
        text: {
          type: 'string',
          description: 'Raw contract text (alternative to url)',
        },
        filename: {
          type: 'string',
          description: 'Original filename (optional, for context)',
        },
      },
    },
  },
  {
    name: 'review_code',
    description:
      'AI-powered code review. Analyzes code for security vulnerabilities (OWASP Top 10), ' +
      'code smells, and optimization opportunities. Returns structured findings with ' +
      'severity levels, descriptions, line numbers, and suggestions. Score 1-10. ' +
      `Costs $0.05 USDC per review.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        code: {
          type: 'string',
          description: 'Source code to review',
        },
        language: {
          type: 'string',
          description: 'Programming language (e.g. TypeScript, Python, Solidity)',
        },
        filename: {
          type: 'string',
          description: 'Filename for language detection (optional)',
        },
        context: {
          type: 'string',
          description: 'Additional context about the code (optional)',
        },
      },
      required: ['code'],
    },
  },
  {
    name: 'synthesize_research',
    description:
      'AI research synthesizer. Given a question, searches multiple sources and returns ' +
      'a structured research brief with executive summary, key findings, organized sections, ' +
      'and citations. Confidence score 0-1. ' +
      `Costs $0.15 USDC per research brief.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        question: {
          type: 'string',
          description: 'Research question (10-500 characters)',
        },
        depth: {
          type: 'string',
          enum: ['quick', 'standard', 'deep'],
          description: 'Research depth: quick (fast), standard (balanced), deep (thorough)',
          default: 'standard',
        },
      },
      required: ['question'],
    },
  },
  {
    name: 'list_services',
    description:
      'List all available services on this platform with their endpoints, pricing, ' +
      'descriptions, and response schemas. Use this to discover what services are available.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
];

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
        const resp = await http.get(`/api/v1/sentiment/${encodeURIComponent(String(args.ticker))}`);
        response = resp.data;
        break;
      }
      case 'get_company_profile': {
        const resp = await http.get(`/api/v1/company/${encodeURIComponent(String(args.domain))}`);
        response = resp.data;
        break;
      }
      case 'enrich_email': {
        const resp = await http.get(`/api/v1/enrich/email/${encodeURIComponent(String(args.email))}`);
        response = resp.data;
        break;
      }
      case 'get_news_summary': {
        const resp = await http.get('/api/v1/news/summary', {
          params: { q: args.query },
        });
        response = resp.data;
        break;
      }
      case 'extract_structured_data': {
        const resp = await http.post('/api/v1/extract', {
          url: args.url,
          html: args.html,
        });
        response = resp.data;
        break;
      }
      case 'analyze_contract': {
        const resp = await http.post('/api/v1/analyze/contract', {
          url: args.url,
          text: args.text,
          filename: args.filename,
        });
        response = resp.data;
        break;
      }
      case 'review_code': {
        const resp = await http.post('/api/v1/review/code', {
          code: args.code,
          language: args.language,
          filename: args.filename,
          context: args.context,
        });
        response = resp.data;
        break;
      }
      case 'synthesize_research': {
        const resp = await http.post('/api/v1/research', {
          question: args.question,
          depth: args.depth ?? 'standard',
        });
        response = resp.data;
        break;
      }
      case 'list_services': {
        const resp = await http.get('/.well-known/agent-services');
        response = resp.data;
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
    const axErr = err as { response?: { status: number; data: unknown }; message: string };

    if (axErr.response?.status === 402) {
      const paymentInfo = axErr.response.data;
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
              `To pay automatically, set MCP_PAYMENT_HEADER in your .env with a valid x402 payment proof.`,
              `You can get test USDC at https://faucet.circle.com/ (Base Sepolia network).`,
            ].join('\n'),
          },
        ],
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: `Error calling ${name}: ${axErr.response?.status ?? 'network error'} — ${axErr.message}`,
        },
      ],
    };
  }
}

// ---------------------------------------------------------------------------
// MCP Server bootstrap
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
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
      `[MCP] Tools available: ${TOOLS.map((t) => t.name).join(', ')}\n`
  );
}

main().catch((err) => {
  process.stderr.write(`[MCP] Fatal error: ${err}\n`);
  process.exit(1);
});
