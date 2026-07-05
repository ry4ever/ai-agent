#!/usr/bin/env node
/**
 * aiscale-pay — CLI for making paid API calls to AiScale Agent Services
 *
 * Usage:
 *   npx aiscale-pay sentiment AAPL
 *   npx aiscale-pay company stripe.com
 *   npx aiscale-pay news "AI agents"
 *   npx aiscale-pay research "State of quantum computing"
 *   npx aiscale-pay code --file ./src/app.ts
 *   npx aiscale-pay contract --file ./contract.pdf
 *   npx aiscale-pay extract --url https://example.com
 *   npx aiscale-pay enrich elon@x.com
 *   npx aiscale-pay list
 *
 * Set MCP_PRIVATE_KEY env var (or --key flag) to enable payments.
 * Without a key, you'll see the 402 payment requirements.
 */

import 'dotenv/config';

const PLATFORM_URL = process.env.PLATFORM_URL ?? 'https://agents.aiscale.pro';
const PRIVATE_KEY = process.env.MCP_PRIVATE_KEY ?? process.env.PRIVATE_KEY ?? '';

interface ServiceDef {
  method: 'GET' | 'POST';
  path: (a: string) => string;
  price: string;
  argName: string;
  description: string;
}

const SERVICES: Record<string, ServiceDef> = {
  sentiment: {
    method: 'GET',
    path: (a: string) => `/api/v1/sentiment/${encodeURIComponent(a)}`,
    price: '$0.002',
    argName: 'ticker',
    description: 'Stock ticker (e.g. AAPL, TSLA)',
  },
  company: {
    method: 'GET',
    path: (a: string) => `/api/v1/company/${encodeURIComponent(a)}`,
    price: '$0.005',
    argName: 'domain',
    description: 'Company domain (e.g. stripe.com)',
  },
  enrich: {
    method: 'GET',
    path: (a: string) => `/api/v1/enrich/email/${encodeURIComponent(a)}`,
    price: '$0.008',
    argName: 'email',
    description: 'Email address (e.g. john@stripe.com)',
  },
  news: {
    method: 'GET',
    path: (a: string) => `/api/v1/news/summary?q=${encodeURIComponent(a)}`,
    price: '$0.003',
    argName: 'query',
    description: 'Topic (e.g. "AI agents")',
  },
  extract: {
    method: 'POST',
    path: () => '/api/v1/extract',
    price: '$0.004',
    argName: 'url',
    description: 'URL to extract data from',
  },
  contract: {
    method: 'POST',
    path: () => '/api/v1/analyze/contract',
    price: '$0.10',
    argName: 'text',
    description: 'Contract text or --url to a PDF',
  },
  code: {
    method: 'POST',
    path: () => '/api/v1/review/code',
    price: '$0.05',
    argName: 'code',
    description: 'Code to review (or --file path)',
  },
  research: {
    method: 'POST',
    path: () => '/api/v1/research',
    price: '$0.15',
    argName: 'question',
    description: 'Research question',
  },
};

function showHelp(): void {
  console.error(`
  aiscale-pay — Make paid API calls to AiScale Agent Services

  Usage:
    aiscale-pay <service> <argument> [options]
    aiscale-pay list

  Services:
    sentiment <ticker>     Stock sentiment ($0.002)    e.g: AAPL
    company   <domain>     Company profile ($0.005)    e.g: stripe.com
    enrich    <email>      Email enrichment ($0.008)   e.g: john@stripe.com
    news      <query>      News summary ($0.003)       e.g: "AI agents"
    extract   <url>        Data extraction ($0.004)    e.g: https://example.com
    contract  [text|--file|--url]  Contract analysis ($0.10)
    code      [code|--file]        Code review ($0.05)
    research  <question>    Research brief ($0.15)
    list                    List all services (free)

  Options:
    --key <hex>      Wallet private key (or set MCP_PRIVATE_KEY env)
    --file <path>    Read argument from file (for contract/code)
    --url <url>      URL argument (for contract)
    --depth <mode>   Research depth: quick|standard|deep

  Environment:
    MCP_PRIVATE_KEY   Wallet private key (0x...)
    PLATFORM_URL      API base URL (default: https://agents.aiscale.pro)

  Examples:
    MCP_PRIVATE_KEY=0x... aiscale-pay sentiment AAPL
    aiscale-pay company stripe.com --key 0x...
    aiscale-pay code --file ./src/app.ts --key 0x...
    aiscale-pay research "State of quantum computing" --depth deep
  `);
}

function readFlag(args: string[], flag: string): string | null {
  const i = args.indexOf(flag);
  if (i === -1 || i + 1 >= args.length) return null;
  return args[i + 1];
}

async function readFile(path: string): Promise<string> {
  const fs = await import('fs/promises');
  return fs.readFile(path, 'utf-8');
}

async function makeCall(
  method: 'GET' | 'POST',
  path: string,
  body?: Record<string, unknown>
): Promise<void> {
  let fetchFn: typeof fetch = fetch;

  if (PRIVATE_KEY) {
    const { wrapFetchWithPayment } = await import('@x402/fetch');
    const { x402Client } = await import('@x402/core/client');
    const { registerExactEvmScheme } = await import('@x402/evm/exact/client');
    const { privateKeyToAccount } = await import('viem/accounts');

    const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);
    console.error(`Wallet: ${account.address}`);
    console.error(`Payment: enabled`);

    const client = new x402Client();
    registerExactEvmScheme(client, { signer: account });
    fetchFn = wrapFetchWithPayment(fetch, client);
  } else {
    console.error(`Payment: disabled (set MCP_PRIVATE_KEY to enable)`);
  }

  const url = `${PLATFORM_URL}${path}`;
  console.error(`\n${method} ${url}\n`);

  const init: RequestInit = method === 'POST'
    ? {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      }
    : {};

  const res = await fetchFn(url, init);

  if (res.status === 402) {
    console.error('Payment required. Response headers:');
    const paymentHeader = res.headers.get('payment-required');
    if (paymentHeader) {
      try {
        const decoded = JSON.parse(
          Buffer.from(paymentHeader, 'base64').toString('utf-8')
        );
        const accept = decoded.accepts?.[0];
        if (accept) {
          const usd = (parseInt(accept.amount) / 1e6).toFixed(6);
          console.error(`  Amount: $${usd} USDC`);
          console.error(`  Pay to: ${accept.payTo}`);
          console.error(`  Network: ${accept.network}`);
        }
      } catch {
        console.error(`  payment-required: ${paymentHeader.slice(0, 200)}...`);
      }
    }
    console.error('\nSet MCP_PRIVATE_KEY to pay automatically.');
    process.exit(1);
  }

  if (!res.ok) {
    console.error(`Error: HTTP ${res.status}`);
    const text = await res.text();
    console.error(text.slice(0, 500));
    process.exit(1);
  }

  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    showHelp();
    return;
  }

  if (args[0] === 'list') {
    await makeCall('GET', '/.well-known/agent-services');
    return;
  }

  const serviceName = args[0];
  const svc = SERVICES[serviceName];

  if (!svc) {
    console.error(`Unknown service: ${serviceName}`);
    console.error('Run "aiscale-pay --help" for available services.');
    process.exit(1);
  }

  // Build the path and body
  let argValue = args[1] ?? '';

  // Handle --file flag for contract/code
  const filePath = readFlag(args, '--file');
  if (filePath) {
    argValue = await readFile(filePath);
  }

  // Handle --url flag for contract
  const urlArg = readFlag(args, '--url');

  if (svc.method === 'GET') {
    if (!argValue) {
      console.error(`Missing argument: ${svc.argName}`);
      console.error(`Usage: aiscale-pay ${serviceName} <${svc.argName}>`);
      process.exit(1);
    }
    await makeCall('GET', svc.path(argValue));
  } else {
    const body: Record<string, unknown> = {};

    if (serviceName === 'research') {
      body.question = argValue;
      body.depth = readFlag(args, '--depth') ?? 'standard';
    } else if (serviceName === 'contract') {
      if (urlArg) body.url = urlArg;
      else body.text = argValue;
    } else if (serviceName === 'code') {
      body.code = argValue;
      const file = readFlag(args, '--file');
      if (file) body.filename = file;
    } else if (serviceName === 'extract') {
      body.url = argValue;
    }

    await makeCall('POST', svc.path(''), body);
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
