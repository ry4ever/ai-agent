import { Request, Response } from 'express';
import { PRICING, microToUSD } from '../config/pricing';

export function agentCardHandler(_req: Request, res: Response): void {
  const walletAddress = process.env.WALLET_ADDRESS ?? '0xYOUR_WALLET_ADDRESS';
  const network = process.env.NETWORK ?? 'base-sepolia';
  const isMainnet = network === 'base-mainnet';

  const card = {
    name: 'AiScale Agent Services',
    description:
      'The marketplace where AI agents buy data, intelligence, and skills. Pay-per-request via x402 micropayments in USDC on Base L2. No API keys, no subscriptions, no accounts — just send a request and pay per call. Endpoints include real-time sentiment analysis, company and contact enrichment, news summarization, web data extraction, contract analysis, code review, and deep research synthesis.',
    url: `${process.env.AGENT_URL ?? 'https://agents.aiscale.pro'}/a2a`,
    version: '1.0.0',
    documentationUrl: `${process.env.AGENT_URL ?? 'https://agents.aiscale.pro'}/docs`,
    provider: {
      organization: process.env.PROVIDER_NAME ?? 'AiScale',
      url: process.env.PROVIDER_URL ?? 'https://aiscale.pro',
    },
    capabilities: {
      streaming: false,
      pushNotifications: false,
      stateTransitionHistory: false,
    },
    defaultInputModes: ['application/json', 'text/plain'],
    defaultOutputModes: ['application/json'],
    skills: [
      {
        id: 'sentiment_analysis',
        name: 'Real-Time Sentiment Analysis',
        description:
          'Returns a sentiment score (-1 to 1), mention volume, and top sources for any stock ticker. Aggregates data from news feeds and social media in real time.',
        tags: ['sentiment', 'stocks', 'finance', 'trading', 'market-data', 'analysis'],
        examples: [
          'Get sentiment for AAPL',
          'What is the current market sentiment for TSLA?',
          'Analyze sentiment for NVDA stock',
        ],
        inputModes: ['application/json', 'text/plain'],
        outputModes: ['application/json'],
      },
      {
        id: 'company_enrichment',
        name: 'Company Data Enrichment',
        description:
          'Given a company domain, returns structured company profile including name, industry, employee count, funding data, tech stack, social links, and key contacts.',
        tags: ['company', 'enrichment', 'data', 'sales', 'leads', 'research', 'b2b'],
        examples: [
          'Get company data for stripe.com',
          'Enrich company profile for anthropic.com',
          'Look up info about openai.com',
        ],
        inputModes: ['application/json'],
        outputModes: ['application/json'],
      },
      {
        id: 'email_enrichment',
        name: 'Email Contact Enrichment',
        description:
          "Given an email address, returns the person's full name, company, job title, LinkedIn URL, and social profiles.",
        tags: ['email', 'contact', 'enrichment', 'sales', 'outreach', 'crm', 'people'],
        examples: [
          'Enrich contact info for john@example.com',
          'Who is the person behind this email address?',
          'Get LinkedIn profile for this email',
        ],
        inputModes: ['application/json'],
        outputModes: ['application/json'],
      },
      {
        id: 'news_summarizer',
        name: 'News Topic Summarizer',
        description:
          'Given a topic or query, returns structured summaries of the most recent and relevant news articles including source, date, relevance score, and key takeaways.',
        tags: ['news', 'summary', 'research', 'current-events', 'briefing', 'monitoring'],
        examples: [
          'Summarize latest news about AI regulation',
          'What are the recent developments in autonomous vehicles?',
          'Get news summary for semiconductor export controls',
        ],
        inputModes: ['application/json', 'text/plain'],
        outputModes: ['application/json'],
      },
      {
        id: 'web_data_extractor',
        name: 'Structured Web Data Extractor',
        description:
          'Given a URL or raw HTML, extracts and returns structured data including entities, facts, tables, metadata, and key information as clean JSON.',
        tags: ['extraction', 'scraping', 'structured-data', 'web', 'html', 'parsing'],
        examples: [
          'Extract structured data from this URL',
          'Parse this HTML and return entities and facts',
          'Pull the key data from this webpage',
        ],
        inputModes: ['application/json'],
        outputModes: ['application/json'],
      },
      {
        id: 'contract_analyzer',
        name: 'Contract & Document Analyzer',
        description:
          'Accepts a contract or legal document as text or PDF, and returns structured risk analysis, key terms extraction, red flags, obligations, deadlines, and a plain-English summary.',
        tags: ['contract', 'legal', 'analysis', 'risk', 'compliance', 'document', 'review'],
        examples: [
          'Analyze this NDA for red flags',
          'Extract key terms from this service agreement',
          'Summarize this contract and highlight risks',
        ],
        inputModes: ['application/json', 'text/plain'],
        outputModes: ['application/json'],
      },
      {
        id: 'code_reviewer',
        name: 'Code Security & Quality Reviewer',
        description:
          'Accepts a code snippet, diff, or file content and returns security vulnerabilities, code smells, optimization suggestions, and best practice violations. Supports Python, JavaScript, TypeScript, Go, Rust, and Solidity.',
        tags: ['code', 'review', 'security', 'audit', 'bugs', 'optimization', 'development'],
        examples: [
          'Review this Python function for security issues',
          'Find bugs in this JavaScript code',
          'Audit this Solidity smart contract',
        ],
        inputModes: ['application/json', 'text/plain'],
        outputModes: ['application/json'],
      },
      {
        id: 'research_synthesizer',
        name: 'Research Question Synthesizer',
        description:
          'Given a research question, searches multiple sources, cross-references findings, and returns a structured research brief with key findings, supporting evidence, citations, confidence scores, and suggested follow-up questions.',
        tags: ['research', 'synthesis', 'analysis', 'report', 'citations', 'deep-research'],
        examples: [
          'Research the current state of quantum computing commercialization',
          'Synthesize findings on AI agent payment infrastructure',
          'What are the latest developments in solid-state batteries?',
        ],
        inputModes: ['application/json', 'text/plain'],
        outputModes: ['application/json'],
      },
    ],
    securitySchemes: {
      x402: {
        type: 'x402',
        description:
          'All endpoints are gated by x402 micropayments. Send a request without payment to receive a 402 response with pricing details. Include an X-PAYMENT header with a valid USDC payment proof on Base L2 to access the service. No API keys or accounts required.',
      },
    },
    security: ['x402'],
    _x402_payment_info: {
      _comment: 'Non-standard metadata to help agents understand payment details upfront',
      network: isMainnet ? 'base-mainnet' : 'base-sepolia',
      chainId: isMainnet ? 'eip155:8453' : 'eip155:84532',
      acceptedTokens: [
        {
          symbol: 'USDC',
          contract: isMainnet
            ? '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
            : '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
          decimals: 6,
        },
      ],
      payTo: walletAddress,
      facilitator: process.env.X402_FACILITATOR_URL ?? 'https://api.cdp.coinbase.com/platform/v2/x402',
      pricing: {
        sentiment_analysis:    { price: `$${microToUSD(PRICING.SENTIMENT)}`,          amountRaw: PRICING.SENTIMENT,          endpoint: 'GET /api/v1/sentiment/:ticker' },
        company_enrichment:    { price: `$${microToUSD(PRICING.COMPANY)}`,            amountRaw: PRICING.COMPANY,            endpoint: 'GET /api/v1/company/:domain' },
        email_enrichment:      { price: `$${microToUSD(PRICING.ENRICH)}`,             amountRaw: PRICING.ENRICH,             endpoint: 'GET /api/v1/enrich/email/:email' },
        news_summarizer:       { price: `$${microToUSD(PRICING.NEWS)}`,               amountRaw: PRICING.NEWS,               endpoint: 'GET /api/v1/news/summary?q=:topic' },
        web_data_extractor:    { price: `$${microToUSD(PRICING.EXTRACT)}`,            amountRaw: PRICING.EXTRACT,            endpoint: 'POST /api/v1/extract' },
        contract_analyzer:     { price: `$${microToUSD(PRICING.CONTRACT_ANALYZER)}`,  amountRaw: PRICING.CONTRACT_ANALYZER,  endpoint: 'POST /api/v1/analyze/contract' },
        code_reviewer:         { price: `$${microToUSD(PRICING.CODE_REVIEWER)}`,      amountRaw: PRICING.CODE_REVIEWER,      endpoint: 'POST /api/v1/review/code' },
        research_synthesizer:  { price: `$${microToUSD(PRICING.RESEARCH_SYNTH)}`,     amountRaw: PRICING.RESEARCH_SYNTH,     endpoint: 'POST /api/v1/research' },
      },
      bazaarDiscovery: 'https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources',
      serviceDiscovery: `${process.env.AGENT_URL ?? 'https://agents.aiscale.pro'}/.well-known/agent-services`,
    },
  };

  res.setHeader('Content-Type', 'application/json');
  res.json(card);
}
