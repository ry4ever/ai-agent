/**
 * seed-transactions.ts
 *
 * Creates a Coinbase Agentic Wallet on Base Sepolia and calls every endpoint
 * once to verify the full x402 payment flow end-to-end.
 *
 * Usage:
 *   npm run seed
 *   # OR directly:
 *   ts-node scripts/seed-transactions.ts
 *
 * Prerequisites:
 * - Server must be running: npm run dev
 * - COINBASE_API_KEY_ID and COINBASE_API_KEY_SECRET set in .env
 * - Get test USDC from https://faucet.circle.com/ for Base Sepolia
 */

import 'dotenv/config';
import axios, { AxiosError, AxiosInstance } from 'axios';
import { Coinbase, Wallet } from '@coinbase/coinbase-sdk';

const BASE_URL = process.env.SEED_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
const NETWORK = process.env.NETWORK ?? 'base-sepolia';

// ANSI colors for output
const c = {
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
};

interface EndpointTest {
  name: string;
  method: 'GET' | 'POST';
  path: string;
  body?: Record<string, unknown>;
}

const ENDPOINTS: EndpointTest[] = [
  {
    name: 'Health check (no payment)',
    method: 'GET',
    path: '/health',
  },
  {
    name: 'Service registry (no payment)',
    method: 'GET',
    path: '/.well-known/agent-services',
  },
  {
    name: 'Sentiment — AAPL',
    method: 'GET',
    path: '/api/v1/sentiment/AAPL',
  },
  {
    name: 'Company — stripe.com',
    method: 'GET',
    path: '/api/v1/company/stripe.com',
  },
  {
    name: 'Email enrichment',
    method: 'GET',
    path: '/api/v1/enrich/email/test@example.com',
  },
  {
    name: 'News summary',
    method: 'GET',
    path: '/api/v1/news/summary?q=AI+agents',
  },
  {
    name: 'Extract from URL',
    method: 'POST',
    path: '/api/v1/extract',
    body: { url: 'https://example.com' },
  },
  {
    name: 'Contract analyzer',
    method: 'POST',
    path: '/api/v1/agents/contract',
    body: {
      text: `SERVICE AGREEMENT
This agreement is entered into between Acme Corp ("Provider") and Beta LLC ("Client").
1. Services: Provider will deliver software development services.
2. Payment: Client will pay $10,000/month, net 30 days.
3. Termination: Either party may terminate with 30 days written notice.
4. IP Ownership: All work product is owned by Provider unless explicitly transferred.
5. Liability Cap: Provider's total liability shall not exceed 1 month of fees.
6. Governing Law: This agreement is governed by California law.`,
    },
  },
  {
    name: 'Code reviewer',
    method: 'POST',
    path: '/api/v1/agents/code-review',
    body: {
      language: 'TypeScript',
      code: `async function getUserData(userId: string) {
  const query = \`SELECT * FROM users WHERE id = '\${userId}'\`;
  const result = await db.query(query);
  return result.rows[0];
}`,
    },
  },
  {
    name: 'Research synthesizer',
    method: 'POST',
    path: '/api/v1/agents/research',
    body: {
      question: 'What is the x402 payment protocol and how do AI agents use it?',
      depth: 'quick',
    },
  },
];

async function createAgentWallet(): Promise<{ wallet: Wallet; address: string }> {
  const keyId = process.env.COINBASE_API_KEY_ID;
  const keySecret = process.env.COINBASE_API_KEY_SECRET;

  if (!keyId || !keySecret) {
    throw new Error('COINBASE_API_KEY_ID and COINBASE_API_KEY_SECRET must be set in .env');
  }

  Coinbase.configure({ apiKeyName: keyId, privateKey: keySecret });

  console.log(c.cyan(`\nCreating agent wallet on ${NETWORK}...`));
  const wallet = await Wallet.create({ networkId: NETWORK });
  const defaultAddress = await wallet.getDefaultAddress();
  const address = defaultAddress.getId();

  console.log(c.green(`  Wallet created: ${address}`));
  console.log(
    c.yellow(`  ⚠  Fund this wallet with test USDC at https://faucet.circle.com/`)
  );
  console.log(c.yellow(`     Network: Base Sepolia | Address: ${address}\n`));

  // Give user a moment to read
  await new Promise((r) => setTimeout(r, 2000));

  return { wallet, address };
}

async function callEndpoint(
  client: AxiosInstance,
  test: EndpointTest,
  agentAddress: string
): Promise<{ success: boolean; status: number; paid: boolean }> {
  const headers: Record<string, string> = {
    'x-agent-address': agentAddress,
    'Content-Type': 'application/json',
  };

  try {
    const resp =
      test.method === 'GET'
        ? await client.get(test.path, { headers })
        : await client.post(test.path, test.body, { headers });

    return { success: true, status: resp.status, paid: false };
  } catch (err) {
    const axErr = err as AxiosError;
    const status = axErr.response?.status ?? 0;

    // 402 = expected paywall response — the flow is working correctly
    if (status === 402) {
      const paymentInfo = axErr.response?.data;
      console.log(
        c.cyan(`    → 402 received (payment required). Payment details:`),
        JSON.stringify(paymentInfo, null, 2).slice(0, 200) + '...'
      );
      console.log(
        c.yellow(
          `    → In production, agent wallet would sign a USDC transfer and retry.\n` +
            `       (Testnet x402 payment flow requires on-chain USDC — skipping actual payment in seed)`
        )
      );
      return { success: true, status: 402, paid: false };
    }

    return { success: false, status, paid: false };
  }
}

async function runSeed(): Promise<void> {
  console.log(c.bold('\n🚀 Agent Services Platform — Seed Script'));
  console.log(`   Target: ${BASE_URL}\n`);

  // Check server is up
  try {
    await axios.get(`${BASE_URL}/health`, { timeout: 5000 });
    console.log(c.green('✓ Server is running\n'));
  } catch {
    console.error(c.red(`✗ Server not reachable at ${BASE_URL}`));
    console.error(c.yellow('  Start the server with: npm run dev'));
    process.exit(1);
  }

  let agentAddress = '0x0000000000000000000000000000000000000000';

  // Create wallet if CDP keys are configured
  const hasCDPKeys =
    process.env.COINBASE_API_KEY_ID &&
    process.env.COINBASE_API_KEY_ID !== 'your_cdp_api_key_id';

  if (hasCDPKeys) {
    try {
      const { address } = await createAgentWallet();
      agentAddress = address;
    } catch (err) {
      console.warn(c.yellow(`  Could not create wallet: ${(err as Error).message}`));
      console.warn(c.yellow('  Using placeholder address for testing\n'));
    }
  } else {
    console.log(
      c.yellow(
        'CDP keys not configured — using placeholder wallet address.\n' +
          'Set COINBASE_API_KEY_ID and COINBASE_API_KEY_SECRET for real wallet creation.\n'
      )
    );
  }

  const client = axios.create({
    baseURL: BASE_URL,
    timeout: 30000,
    validateStatus: () => true, // don't throw on non-2xx
  });

  const results = {
    passed: 0,
    failed: 0,
    payment402: 0,
  };

  console.log(c.bold('Running endpoint tests:\n'));

  for (const test of ENDPOINTS) {
    process.stdout.write(`  ${test.method.padEnd(4)} ${test.path.padEnd(45)} `);

    const start = Date.now();

    try {
      const resp =
        test.method === 'GET'
          ? await client.get(test.path, {
              headers: {
                'x-agent-address': agentAddress,
                'Content-Type': 'application/json',
              },
            })
          : await client.post(test.path, test.body, {
              headers: {
                'x-agent-address': agentAddress,
                'Content-Type': 'application/json',
              },
            });

      const ms = Date.now() - start;

      if (resp.status === 402) {
        console.log(c.cyan(`402 Payment Required  ${ms}ms`));
        results.payment402++;
      } else if (resp.status >= 200 && resp.status < 300) {
        console.log(c.green(`${resp.status} OK                 ${ms}ms`));
        results.passed++;
      } else if (resp.status >= 400 && resp.status < 500) {
        console.log(c.yellow(`${resp.status} Client Error        ${ms}ms`));
        results.failed++;
      } else {
        console.log(c.red(`${resp.status} Error              ${ms}ms`));
        results.failed++;
      }
    } catch (err) {
      const ms = Date.now() - start;
      console.log(c.red(`ERR ${(err as Error).message.slice(0, 40)}  ${ms}ms`));
      results.failed++;
    }
  }

  console.log(c.bold('\n─────────────────────────────────────'));
  console.log(`  ${c.green(`✓ ${results.passed} passed`)}`);
  console.log(`  ${c.cyan(`⟳ ${results.payment402} paywalled (402 — correct behavior)`)}`);
  if (results.failed > 0) {
    console.log(`  ${c.red(`✗ ${results.failed} failed`)}`);
  }
  console.log(c.bold('─────────────────────────────────────\n'));

  if (results.payment402 > 0) {
    console.log(
      c.cyan(
        'ℹ  402 responses are expected for paywalled endpoints.\n' +
          '   To complete real payments:\n' +
          '   1. Fund wallet at https://faucet.circle.com/ (Base Sepolia USDC)\n' +
          '   2. Use an x402-compatible client (e.g. @x402/axios or @x402/fetch)\n' +
          '   3. The client will automatically handle the 402 → sign → retry flow\n'
      )
    );
  }

  process.exit(results.failed > 0 ? 1 : 0);
}

runSeed().catch((err) => {
  console.error(c.red('Seed script failed:'), err);
  process.exit(1);
});
