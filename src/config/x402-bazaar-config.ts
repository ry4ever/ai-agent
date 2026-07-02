// ============================================================
// x402-bazaar-config.ts — AiScale Agent Services
// https://aiscale.pro
// ============================================================
// Defines Bazaar discovery metadata for every endpoint.
// The Express middleware uses this so each route is auto-listed
// in the x402 Bazaar on first payment.
//
// REFERENCE: https://docs.cdp.coinbase.com/x402/bazaar
// PACKAGE:   @x402/extensions/bazaar
// ============================================================
import { declareDiscoveryExtension } from '@x402/extensions/bazaar';
import type { RouteConfig } from '@x402/core/server';
import { PRICING, microToUSD } from './pricing';

// ── Network: resolved at runtime from NETWORK env var ──
// CAIP-2 format: eip155:<chainId>
const NETWORK_MAP: Record<string, string> = {
  'base-mainnet': 'eip155:8453',
  'base-sepolia': 'eip155:84532',
};

function getNetwork(): `${string}:${string}` {
  return (NETWORK_MAP[process.env.NETWORK ?? 'base-sepolia'] ?? 'eip155:84532') as `${string}:${string}`;
}

function getPayTo(): string {
  return process.env.WALLET_ADDRESS ?? '';
}

// ── Helper ──
interface DiscoveryRouteConfig {
  pricingKey: keyof typeof PRICING;
  description: string;
  input: {
    method: string;
    resource: string;
    params?: Record<string, string>;
    body?: Record<string, string>;
  };
  output: {
    example: Record<string, unknown>;
  };
}

function buildRouteConfig(config: DiscoveryRouteConfig): RouteConfig {
  return {
    accepts: [
      {
        scheme: 'exact',
        // Price derived from pricing.ts — single source of truth
        price: `$${microToUSD(PRICING[config.pricingKey])}`,
        network: getNetwork(),
        payTo: getPayTo,
      },
    ],
    description: config.description,
    extensions: {
      ...declareDiscoveryExtension({
        description: config.description,
        input: {
          method: config.input.method,
          resource: config.input.resource,
          ...(config.input.params && { params: config.input.params }),
          ...(config.input.body && { body: config.input.body }),
        },
        output: {
          example: config.output.example,
        },
      }),
    },
  };
}

// ============================================================
// ROUTE DEFINITIONS — AiScale Agent Services
// ============================================================
export const routeConfigs: Record<string, RouteConfig> = {
  // ── DATA API ENDPOINTS ──
  'GET /api/v1/sentiment/:ticker': buildRouteConfig({
    pricingKey: 'SENTIMENT',
    description:
      'AiScale Sentiment: Real-time sentiment analysis for a stock ticker. Returns score (-1 to 1), mention volume, source breakdown, and trend direction.',
    input: {
      method: 'GET',
      resource: '/api/v1/sentiment/:ticker',
      params: {
        ticker: 'Stock ticker symbol, e.g. AAPL, TSLA, NVDA',
      },
    },
    output: {
      example: {
        ticker: 'AAPL',
        sentiment: 0.72,
        volume: 14230,
        trend: 'bullish',
        sources: { news: 0.68, social: 0.76, reddit: 0.71 },
        timestamp: '2026-03-20T12:00:00Z',
      },
    },
  }),

  'GET /api/v1/company/:domain': buildRouteConfig({
    pricingKey: 'COMPANY',
    description:
      'AiScale Company Enrichment: Returns company name, industry, employee count, funding, tech stack, social links, and key executives for any domain.',
    input: {
      method: 'GET',
      resource: '/api/v1/company/:domain',
      params: {
        domain: 'Company website domain, e.g. stripe.com, anthropic.com',
      },
    },
    output: {
      example: {
        domain: 'stripe.com',
        name: 'Stripe, Inc.',
        industry: 'Financial Technology',
        employeeCount: 8000,
        founded: 2010,
        funding: { total: '$8.7B', lastRound: 'Series I' },
        techStack: ['React', 'Ruby', 'Go', 'AWS'],
        social: {
          twitter: 'https://twitter.com/stripe',
          linkedin: 'https://linkedin.com/company/stripe',
        },
      },
    },
  }),

  'GET /api/v1/enrich/email/:email': buildRouteConfig({
    pricingKey: 'ENRICH',
    description:
      'AiScale Contact Enrichment: Given an email, returns full name, company, title, LinkedIn URL, and social profiles.',
    input: {
      method: 'GET',
      resource: '/api/v1/enrich/email/:email',
      params: {
        email: 'Email address to enrich, e.g. john@example.com',
      },
    },
    output: {
      example: {
        email: 'john@example.com',
        fullName: 'John Smith',
        company: 'Example Corp',
        title: 'VP of Engineering',
        linkedin: 'https://linkedin.com/in/johnsmith',
        twitter: '@johnsmith',
        location: 'San Francisco, CA',
      },
    },
  }),

  'GET /api/v1/news/summary': buildRouteConfig({
    pricingKey: 'NEWS',
    description:
      'AiScale News Summary: Summarizes recent news for a topic. Returns structured summaries with source, date, relevance score, and key takeaways.',
    input: {
      method: 'GET',
      resource: '/api/v1/news/summary',
      params: {
        q: "Topic or search query, e.g. 'AI regulation', 'semiconductor exports'",
        limit: 'Number of articles to summarize (default: 5, max: 20)',
      },
    },
    output: {
      example: {
        query: 'AI regulation',
        articles: [
          {
            title: 'EU AI Act Implementation Begins',
            source: 'Reuters',
            date: '2026-03-19',
            relevance: 0.95,
            summary: 'The EU begins enforcing...',
            url: 'https://...',
          },
        ],
        totalResults: 5,
        timestamp: '2026-03-20T12:00:00Z',
      },
    },
  }),

  'POST /api/v1/extract': buildRouteConfig({
    pricingKey: 'EXTRACT',
    description:
      'AiScale Data Extractor: Extracts structured data from a URL or raw HTML. Returns entities, facts, tables, and metadata as clean JSON.',
    input: {
      method: 'POST',
      resource: '/api/v1/extract',
      body: {
        url: 'URL to extract data from (provide url OR html, not both)',
        html: 'Raw HTML string to parse (provide url OR html, not both)',
      },
    },
    output: {
      example: {
        title: 'Page Title',
        entities: [
          { name: 'OpenAI', type: 'organization' },
          { name: 'Sam Altman', type: 'person' },
        ],
        facts: ['OpenAI was founded in 2015'],
        tables: [[['Header1', 'Header2'], ['row1col1', 'row1col2']]],
        metadata: { author: '...', publishDate: '2026-03-19', wordCount: 1520 },
      },
    },
  }),

  // ── SUB-AGENT ENDPOINTS ──
  'POST /api/v1/analyze/contract': buildRouteConfig({
    pricingKey: 'CONTRACT_ANALYZER',
    description:
      'AiScale Contract Analyzer: Analyzes legal contracts/documents. Returns risk analysis, key terms, obligations, deadlines, red flags, and plain-English summary.',
    input: {
      method: 'POST',
      resource: '/api/v1/analyze/contract',
      body: {
        text: 'Contract text content (provide text OR url)',
        url: 'URL to a text or PDF contract (provide text OR url)',
      },
    },
    output: {
      example: {
        summary: 'This is a 2-year SaaS agreement with...',
        keyTerms: [{ term: 'Auto-renewal', section: '7.1', detail: 'Renews annually unless...' }],
        risks: [{ severity: 'high', issue: 'Unlimited liability clause in Section 9.2' }],
        obligations: [{ party: 'client', action: 'Payment within 30 days', deadline: 'monthly' }],
        redFlags: ['Non-compete clause extends 3 years post-termination'],
        confidenceScore: 0.89,
      },
    },
  }),

  'POST /api/v1/review/code': buildRouteConfig({
    pricingKey: 'CODE_REVIEWER',
    description:
      'AiScale Code Reviewer: Reviews code for security vulnerabilities, bugs, code smells, and optimizations. Supports Python, JS, TS, Go, Rust, Solidity.',
    input: {
      method: 'POST',
      resource: '/api/v1/review/code',
      body: {
        code: 'Code string to review',
        language: 'Programming language (auto-detected if omitted)',
        context: 'Optional context about what the code does',
      },
    },
    output: {
      example: {
        language: 'python',
        issues: [
          {
            severity: 'critical',
            type: 'security',
            line: 42,
            message: 'SQL injection vulnerability',
            suggestion: 'Use parameterized queries',
          },
        ],
        metrics: { complexity: 'moderate', maintainability: 72, testability: 'low' },
        overallRisk: 'medium',
      },
    },
  }),

  'POST /api/v1/research': buildRouteConfig({
    pricingKey: 'RESEARCH_SYNTH',
    description:
      'AiScale Research Synthesizer: Deep research on any topic. Searches multiple sources and returns structured brief with findings, evidence, citations, and confidence scores.',
    input: {
      method: 'POST',
      resource: '/api/v1/research',
      body: {
        question: 'Research question or topic',
        depth: "'quick' (3-5 sources) or 'deep' (10+ sources). Default: 'standard'",
      },
    },
    output: {
      example: {
        question: 'Current state of quantum computing commercialization?',
        summary: 'Quantum computing is transitioning from...',
        findings: [
          {
            claim: 'IBM plans 100,000-qubit systems by 2033',
            evidence: 'IBM Quantum roadmap...',
            confidence: 0.92,
            sources: ['https://...'],
          },
        ],
        conflictingInfo: [],
        followUpQuestions: ['What are the leading error correction approaches?'],
        sourcesConsulted: 7,
        timestamp: '2026-03-20T12:00:00Z',
      },
    },
  }),
};
