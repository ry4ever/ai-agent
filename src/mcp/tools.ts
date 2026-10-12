/**
 * MCP tool definitions — single source of truth for both the stdio MCP server
 * (src/mcp/server.ts) and the HTTP MCP server (src/mcp/http-server.ts).
 *
 * Previously these arrays were duplicated and drifted: the HTTP version (the
 * one Smithery actually sees) had terse one-liners while the stdio version
 * had richer descriptions. One array means no drift.
 *
 * Descriptions follow a consistent template designed for agent routers
 * (Claude, Cursor, Smithery discovery):
 *   1. First sentence — what the agent gets back.
 *   2. "Call when…" triggers — the strings routers match on when deciding
 *      whether to invoke this tool from a user prompt.
 *   3. Keywords users search on (ticker, lead, contract, OWASP, …) baked in.
 *   4. Short price tag at the end.
 *
 * Tool names, `required` fields, and parameter shapes are stable — any rename
 * is a breaking change for existing clients.
 */
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const MCP_TOOLS: Tool[] = [
  {
    name: 'get_sentiment',
    description:
      'Market sentiment for a stock, crypto, or ETF ticker, aggregated from recent news articles and social-media mentions. ' +
      'Returns a signed score from -1 (bearish) to +1 (bullish), a human-readable label, mention volume, and source count. ' +
      'Call before placing a trade, when summarising a portfolio, or when the user asks "what are people saying about X". ' +
      'Costs ~$0.002 USDC per call (paid automatically if MCP_PRIVATE_KEY is set).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        ticker: {
          type: 'string',
          description:
            'Stock, crypto, or ETF ticker (case-insensitive). Examples: "AAPL", "TSLA", "NVDA", "BTC", "ETH", "SPY", "QQQ".',
        },
      },
      required: ['ticker'],
    },
  },
  {
    name: 'get_company_profile',
    description:
      'Enriched company profile from a website domain: legal name, industry, headcount, founding year, HQ location, social links, and detected tech stack. ' +
      'Call to qualify a lead, prepare a sales pitch, add structured context about any company before further analysis, or verify a prospect is real. ' +
      'Costs ~$0.005 USDC per call.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        domain: {
          type: 'string',
          description:
            'Company website domain, no scheme and no www. Examples: "stripe.com", "openai.com", "anthropic.com".',
        },
      },
      required: ['domain'],
    },
  },
  {
    name: 'enrich_email',
    description:
      "Person lookup from an email address: full name, employer, job title, LinkedIn URL, and a confidence score. " +
      "Call to personalise outreach, verify a lead's identity before replying, or disambiguate a generic first name on a thread. " +
      'Costs ~$0.008 USDC per call.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        email: {
          type: 'string',
          description: 'Valid email address, lowercased. Examples: "patrick@stripe.com", "sam@openai.com".',
        },
      },
      required: ['email'],
    },
  },
  {
    name: 'get_news_summary',
    description:
      'Recent-news digest for any topic, keyword, or company. ' +
      'Returns titled items with source, URL, relevance score, and a 1–2 sentence takeaway. ' +
      "Call for daily briefings, event monitoring, competitive intel, due diligence, or when the user asks \"what's happening with X right now\" or \"any news on Y\". " +
      'Costs ~$0.003 USDC per call.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description:
            'Topic, company, person, event, or keyword to search for. Examples: "AI agents", "Base L2", "OpenAI governance", "SEC crypto enforcement".',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'extract_structured_data',
    description:
      'Scrape and extract structured JSON from any web page (or raw HTML): named entities, key facts, tables, and metadata. ' +
      'Call when the user shares a URL and expects data back as rows or objects, when ingesting a webpage without writing a custom scraper, or to pull structured facts from a documentation page before answering. ' +
      'Costs ~$0.004 USDC per call.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        url: {
          type: 'string',
          description:
            'Fully-qualified URL to fetch. Must be publicly accessible (private IPs are blocked for security). Example: "https://example.com/pricing".',
        },
        html: {
          type: 'string',
          description:
            'Raw HTML string to parse instead of fetching a URL. Use when you already have the HTML (e.g. from a browser automation step).',
        },
      },
    },
  },
  {
    name: 'analyze_contract',
    description:
      'Risk-ranked analysis of a legal contract (NDA, SaaS agreement, employment, lease, SOW, loan, licence, etc.) from a PDF URL or raw text. ' +
      'Returns extracted key terms, obligations, deadlines, severity-ranked risks (low → critical), red flags, a plain-English summary, and an overall risk score 1–10. ' +
      'Call before signing anything, when reviewing a counterparty\'s draft, when a user asks "is this contract safe", or to flag concerning clauses in a vendor agreement. ' +
      'Costs ~$0.10 USDC per analysis.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        url: {
          type: 'string',
          description: 'Public URL to a contract PDF or plain-text file. Mutually exclusive with `text`.',
        },
        text: {
          type: 'string',
          description:
            'Raw contract text. Use when the contract is already in the conversation or clipboard. Mutually exclusive with `url`.',
        },
        filename: {
          type: 'string',
          description: 'Original filename, for context in the analysis (e.g. "msa-acme-2026.pdf"). Optional.',
        },
      },
    },
  },
  {
    name: 'review_code',
    description:
      'Security and quality review for a source-code snippet or file. ' +
      'Flags vulnerabilities aligned with OWASP Top 10, code smells, and optimisation opportunities as structured findings with severity, line numbers, and fix suggestions. Overall score 1–10. ' +
      'Supports TypeScript, JavaScript, Python, Go, Rust, Solidity, and most mainstream languages. ' +
      "Call before merging a PR, when auditing a dependency, when the user asks \"is this code safe\" or \"review this function\", or to double-check LLM-generated code. " +
      'Costs ~$0.05 USDC per review.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        code: {
          type: 'string',
          description: 'Source code to review (single file or snippet, up to ~100 kB).',
        },
        language: {
          type: 'string',
          description:
            'Programming language, if known. Helps the reviewer apply language-specific lints. Examples: "typescript", "python", "go", "rust", "solidity".',
        },
        filename: {
          type: 'string',
          description: 'Original filename, used for language auto-detection when `language` is omitted (e.g. "handler.ts"). Optional.',
        },
        context: {
          type: 'string',
          description: 'One or two sentences explaining what the code is meant to do. Improves the reviewer\'s judgement on intent-vs-bug. Optional.',
        },
      },
      required: ['code'],
    },
  },
  {
    name: 'synthesize_research',
    description:
      'Multi-source research brief for any question. ' +
      'Searches across web sources, cross-references findings, and returns an executive summary, key claims with citations, grouped sections, and a confidence score 0–1. ' +
      'Choose depth: "quick" for a one-paragraph briefing, "standard" for a full report, "deep" for 10+ sources with contradictions surfaced. ' +
      'Call for market research, competitive analysis, due-diligence summaries, policy briefings, or any open-ended "tell me about X" question that would otherwise take a human an hour to Google. ' +
      'Costs ~$0.15 USDC per brief.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        question: {
          type: 'string',
          description:
            'The research question in natural language, 10–500 characters. Phrase it as a question (e.g. "What is the current adoption of x402 micropayments on Base?") rather than a keyword list.',
        },
        depth: {
          type: 'string',
          enum: ['quick', 'standard', 'deep'],
          description:
            'Research depth: "quick" (3–5 sources, ~15s), "standard" (balanced, default), "deep" (10+ sources, ~60s, surfaces contradictions).',
          default: 'standard',
        },
      },
      required: ['question'],
    },
  },
  {
    name: 'list_services',
    description:
      'Discover every tool exposed by this server: endpoint path, HTTP method, price in USDC, description, response schema, and typical latency. ' +
      'Call once at startup to see what\'s available, or whenever you need to confirm pricing or response shape before invoking a specific tool. ' +
      'Free (no payment required).',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
];
