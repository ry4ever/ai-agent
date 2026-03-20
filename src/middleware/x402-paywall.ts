import { paymentMiddleware } from '@x402/express';
import { x402ResourceServer, HTTPFacilitatorClient } from '@x402/core/server';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { bazaarResourceServerExtension, declareDiscoveryExtension } from '@x402/extensions/bazaar';
import { RequestHandler } from 'express';
import { PRICING, microToUSD } from '../config/pricing';
import { SERVICE_DEFINITIONS, ServiceDefinition } from '../config/services';
import { logger } from './logger';

// CAIP-2 chain IDs for Base networks
const NETWORK_MAP: Record<string, string> = {
  'base-mainnet': 'eip155:8453',
  'base-sepolia': 'eip155:84532',
};

function getChainId(): string {
  const network = process.env.NETWORK ?? 'base-sepolia';
  return NETWORK_MAP[network] ?? 'eip155:84532';
}

function getPayTo(): string {
  const addr = process.env.WALLET_ADDRESS ?? '';
  if (!addr) {
    logger.warn('WALLET_ADDRESS not set — payments will be uncollectable');
  }
  return addr;
}

// --- Shared resource server (singleton) ---

let _resourceServer: x402ResourceServer | null = null;

export function getResourceServer(): x402ResourceServer {
  if (_resourceServer) return _resourceServer;

  const facilitatorUrl = process.env.X402_FACILITATOR_URL ?? 'https://x402.org/facilitator';

  // HTTPFacilitatorClient takes a plain URL string (confirmed from @x402/core source)
  const facilitatorClient = new HTTPFacilitatorClient(facilitatorUrl);

  // Register both networks so the same server handles testnet + mainnet
  _resourceServer = new x402ResourceServer(facilitatorClient)
    .register('eip155:84532', new ExactEvmScheme())  // Base Sepolia (testnet)
    .register('eip155:8453', new ExactEvmScheme());   // Base Mainnet

  // Register Bazaar discovery extension so the facilitator can catalog our services
  _resourceServer.registerExtension(bazaarResourceServerExtension);

  logger.info('x402 resource server initialized', {
    facilitator: facilitatorUrl,
    network: getChainId(),
  });

  return _resourceServer;
}

// --- Discovery metadata builders per service ---

interface DiscoveryConfig {
  input?: Record<string, unknown>;
  inputSchema?: Record<string, unknown>;
  output?: { example: Record<string, unknown> };
  bodyType?: 'json' | 'form-data' | 'text';
}

function discoveryFor(svc: ServiceDefinition): DiscoveryConfig {
  const base: DiscoveryConfig = {
    output: {
      example: svc.responseSchema as Record<string, unknown>,
    },
  };

  if (svc.method === 'POST') {
    return {
      ...base,
      bodyType: 'json',
      inputSchema: {
        type: 'object',
        properties: Object.fromEntries(
          Object.entries(svc.responseSchema).map(([k]) => [k, { type: 'string' }])
        ),
      },
    };
  }

  if (svc.params) {
    return {
      ...base,
      input: Object.fromEntries(
        Object.entries(svc.params).map(([k, desc]) => [k, `example_${k}`])
      ),
      inputSchema: {
        type: 'object',
        properties: Object.fromEntries(
          Object.entries(svc.params).map(([k, desc]) => [k, { type: 'string', description: desc }])
        ),
      },
    };
  }

  return base;
}

// --- Route-level paywall factory ---
// Creates a per-endpoint paymentMiddleware with Bazaar discovery metadata.
// Each route in the app calls createPaywall() for its specific endpoint.

export function createPaywall(
  method: 'GET' | 'POST',
  routePattern: string,
  pricingKey: keyof typeof PRICING,
  description: string,
  discoveryConfig?: DiscoveryConfig
): RequestHandler {
  const routeKey = `${method} ${routePattern}`;
  const priceUSD = `$${microToUSD(PRICING[pricingKey])}`;
  const network = getChainId();
  const payTo = getPayTo();
  const server = getResourceServer();

  const discovery = discoveryConfig ?? {};

  return paymentMiddleware(
    {
      [routeKey]: {
        accepts: [
          {
            scheme: 'exact',
            price: priceUSD,
            network,
            payTo,
          },
        ],
        description,
        extensions: {
          ...declareDiscoveryExtension(discovery),
        },
      },
    },
    server
  ) as RequestHandler;
}

// --- Pre-built paywalls for every service endpoint ---
// Lazily instantiated on first call.

let _paywalls: Record<string, RequestHandler> | null = null;

export function getPaywalls(): Record<string, RequestHandler> {
  if (_paywalls) return _paywalls;

  _paywalls = {
    sentiment: createPaywall(
      'GET', '/api/v1/sentiment/:ticker', 'SENTIMENT',
      'Real-time sentiment score for a stock ticker (-1 to 1) from news and social data',
      {
        input: { ticker: 'AAPL' },
        inputSchema: { properties: { ticker: { type: 'string', description: 'Stock ticker symbol' } }, required: ['ticker'] },
        output: { example: { ticker: 'AAPL', score: 0.42, label: 'bullish', volume: 25, sources: 12, cachedAt: '2026-03-20T00:00:00Z' } },
      }
    ),

    company: createPaywall(
      'GET', '/api/v1/company/:domain', 'COMPANY',
      'Company profile: name, industry, employee count, funding, tech stack, social links',
      {
        input: { domain: 'stripe.com' },
        inputSchema: { properties: { domain: { type: 'string', description: 'Company domain name' } }, required: ['domain'] },
        output: { example: { domain: 'stripe.com', name: 'Stripe', industry: 'FinTech', employeeCount: '4000-5000', founded: '2010' } },
      }
    ),

    enrich: createPaywall(
      'GET', '/api/v1/enrich/email/:email', 'ENRICH',
      'Email enrichment: full name, company, role, LinkedIn URL, and social profiles',
      {
        input: { email: 'user@example.com' },
        inputSchema: { properties: { email: { type: 'string', format: 'email' } }, required: ['email'] },
        output: { example: { email: 'user@example.com', firstName: 'John', lastName: 'Doe', company: 'Acme', role: 'CTO', confidence: 85 } },
      }
    ),

    news: createPaywall(
      'GET', '/api/v1/news/summary', 'NEWS',
      'Summarized recent news for a topic with sources, dates, and relevance scores',
      {
        input: { q: 'artificial intelligence agents' },
        inputSchema: { properties: { q: { type: 'string', description: 'Search topic or query' } }, required: ['q'] },
        output: { example: { query: 'AI agents', summaries: [{ title: 'Example', summary: '...', source: 'TechCrunch' }], totalResults: 5 } },
      }
    ),

    extract: createPaywall(
      'POST', '/api/v1/extract', 'EXTRACT',
      'Extract structured data (entities, facts, tables) from any URL or HTML',
      {
        bodyType: 'json',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string', format: 'uri', description: 'URL to fetch and extract from' },
            html: { type: 'string', description: 'Raw HTML to extract from' },
          },
        },
        output: { example: { url: 'https://example.com', title: 'Example', entities: [], facts: [], tables: [] } },
      }
    ),

    contractAnalyzer: createPaywall(
      'POST', '/api/v1/agents/contract', 'CONTRACT_ANALYZER',
      'AI contract analyzer: risk analysis, key terms, red flags, and plain-English summary',
      {
        bodyType: 'json',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string', format: 'uri', description: 'URL to PDF or text contract' },
            text: { type: 'string', description: 'Raw contract text' },
          },
        },
        output: { example: { summary: '...', keyTerms: [], risks: [], redFlags: [], overallRiskScore: 4 } },
      }
    ),

    codeReviewer: createPaywall(
      'POST', '/api/v1/agents/code-review', 'CODE_REVIEWER',
      'AI code reviewer: security vulnerabilities, code smells, and optimization suggestions',
      {
        bodyType: 'json',
        inputSchema: {
          type: 'object',
          properties: {
            code: { type: 'string', description: 'Code to review' },
            language: { type: 'string', description: 'Programming language' },
            filename: { type: 'string' },
          },
          required: ['code'],
        },
        output: { example: { summary: '...', vulnerabilities: [], codeSmells: [], suggestions: [], overallScore: 8 } },
      }
    ),

    researchSynth: createPaywall(
      'POST', '/api/v1/agents/research', 'RESEARCH_SYNTH',
      'AI research synthesizer: structured brief with key findings and citations for any question',
      {
        bodyType: 'json',
        inputSchema: {
          type: 'object',
          properties: {
            question: { type: 'string', description: 'Research question (10-500 chars)' },
            depth: { type: 'string', enum: ['quick', 'standard', 'deep'], default: 'standard' },
          },
          required: ['question'],
        },
        output: { example: { question: '...', summary: '...', keyFindings: [], sections: [], citations: [], confidence: 0.85 } },
      }
    ),
  };

  return _paywalls;
}
