import { PRICING, microToUSD } from './pricing';

export interface ServiceDefinition {
  endpoint: string;
  method: 'GET' | 'POST';
  description: string;
  priceUSDC: string;
  priceDisplay: string;
  category: 'data-api' | 'sub-agent' | 'compute';
  responseSchema: Record<string, unknown>;
  sla: { avgLatencyMs: number; uptime: string };
  params?: Record<string, string>;
}

export const SERVICE_DEFINITIONS: ServiceDefinition[] = [
  {
    endpoint: '/api/v1/sentiment/:ticker',
    method: 'GET',
    description: 'Real-time sentiment score for a stock ticker aggregated from news + social. Returns score (-1 to 1), volume, and sources.',
    priceUSDC: microToUSD(PRICING.SENTIMENT),
    priceDisplay: '$0.002',
    category: 'data-api',
    params: { ticker: 'Stock ticker symbol (e.g. AAPL, TSLA, BTC)' },
    responseSchema: {
      ticker: 'string',
      score: 'number (-1 to 1)',
      label: 'string (bearish|neutral|bullish)',
      volume: 'number',
      sources: 'number',
      cachedAt: 'string (ISO 8601)',
    },
    sla: { avgLatencyMs: 300, uptime: '99.5%' },
  },
  {
    endpoint: '/api/v1/company/:domain',
    method: 'GET',
    description: 'Company profile: name, industry, employee count, funding, tech stack, and social links.',
    priceUSDC: microToUSD(PRICING.COMPANY),
    priceDisplay: '$0.005',
    category: 'data-api',
    params: { domain: 'Company domain name (e.g. stripe.com)' },
    responseSchema: {
      domain: 'string',
      name: 'string',
      description: 'string',
      industry: 'string',
      employeeCount: 'string',
      founded: 'string',
      location: 'string',
      socialLinks: 'object',
      techStack: 'string[]',
    },
    sla: { avgLatencyMs: 500, uptime: '99.5%' },
  },
  {
    endpoint: '/api/v1/enrich/email/:email',
    method: 'GET',
    description: 'Email enrichment: full name, company, role, LinkedIn URL, and social profiles.',
    priceUSDC: microToUSD(PRICING.ENRICH),
    priceDisplay: '$0.008',
    category: 'data-api',
    params: { email: 'Email address to enrich' },
    responseSchema: {
      email: 'string',
      firstName: 'string',
      lastName: 'string',
      fullName: 'string',
      company: 'string',
      role: 'string',
      linkedinUrl: 'string',
      confidence: 'number (0-100)',
    },
    sla: { avgLatencyMs: 600, uptime: '99.0%' },
  },
  {
    endpoint: '/api/v1/news/summary',
    method: 'GET',
    description: 'Summarized recent news for a topic. Returns structured summaries with sources, dates, and relevance scores.',
    priceUSDC: microToUSD(PRICING.NEWS),
    priceDisplay: '$0.003',
    category: 'data-api',
    params: { q: 'Search query / topic' },
    responseSchema: {
      query: 'string',
      summaries: 'Array<{ title, summary, source, url, publishedAt, relevance }>',
      totalResults: 'number',
      generatedAt: 'string (ISO 8601)',
    },
    sla: { avgLatencyMs: 2000, uptime: '99.0%' },
  },
  {
    endpoint: '/api/v1/extract',
    method: 'POST',
    description: 'Extract structured data from a URL or HTML payload. Returns clean JSON of entities, facts, and tables.',
    priceUSDC: microToUSD(PRICING.EXTRACT),
    priceDisplay: '$0.004',
    category: 'data-api',
    responseSchema: {
      url: 'string',
      title: 'string',
      entities: 'Array<{ name, type, value }>',
      facts: 'string[]',
      tables: 'Array<object[]>',
      wordCount: 'number',
    },
    sla: { avgLatencyMs: 3000, uptime: '99.0%' },
  },
  {
    endpoint: '/api/v1/agents/contract',
    method: 'POST',
    description: 'Contract analyzer: accepts PDF URL or raw text, returns structured risk analysis, key terms, red flags, and plain-English summary.',
    priceUSDC: microToUSD(PRICING.CONTRACT_ANALYZER),
    priceDisplay: '$0.10',
    category: 'sub-agent',
    responseSchema: {
      summary: 'string',
      keyTerms: 'Array<{ term, value, page }>',
      risks: 'Array<{ severity, description, clause }>',
      redFlags: 'string[]',
      overallRiskScore: 'number (0-10)',
    },
    sla: { avgLatencyMs: 15000, uptime: '99.0%' },
  },
  {
    endpoint: '/api/v1/agents/code-review',
    method: 'POST',
    description: 'Code reviewer: accepts code diff or file content, returns security vulnerabilities, code smells, and optimization suggestions.',
    priceUSDC: microToUSD(PRICING.CODE_REVIEWER),
    priceDisplay: '$0.05',
    category: 'sub-agent',
    responseSchema: {
      summary: 'string',
      vulnerabilities: 'Array<{ severity, type, description, line }>',
      codeSmells: 'Array<{ type, description, suggestion }>',
      suggestions: 'string[]',
      overallScore: 'number (0-10)',
    },
    sla: { avgLatencyMs: 10000, uptime: '99.0%' },
  },
  {
    endpoint: '/api/v1/agents/research',
    method: 'POST',
    description: 'Research synthesizer: accepts a question, searches multiple sources, returns a structured brief with citations.',
    priceUSDC: microToUSD(PRICING.RESEARCH_SYNTH),
    priceDisplay: '$0.15',
    category: 'sub-agent',
    responseSchema: {
      question: 'string',
      summary: 'string',
      keyFindings: 'string[]',
      sections: 'Array<{ title, content }>',
      citations: 'Array<{ title, url, relevance }>',
      confidence: 'number (0-1)',
    },
    sla: { avgLatencyMs: 20000, uptime: '98.5%' },
  },
];
