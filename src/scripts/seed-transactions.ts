/**
 * seed-transactions.ts
 *
 * E2E smoke test for every protected endpoint on agents.aiscale.pro.
 * For each endpoint it:
 *   1. Sends an unpaid request → expects 402
 *   2. Parses the payment requirement from the 402 response
 *   3. Signs a payment payload using the test-agent CDP account
 *   4. Retries with the X-PAYMENT header → expects 200
 *
 * Usage:
 *   npm run seed
 *
 * Required env vars (same as the server):
 *   CDP_API_KEY_ID, CDP_API_KEY_SECRET, CDP_WALLET_SECRET
 */

import 'dotenv/config';
import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import { CdpClient } from '@coinbase/cdp-sdk';
import { x402Client, x402HTTPClient } from '@x402/core/client';
import { registerExactEvmScheme } from '@x402/evm/exact/client';
import { sec1ToP256Pkcs8Pem } from '../utils/pem';

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL = 'https://agents.aiscale.pro';
const NETWORK = 'base-sepolia';
const AGENT_ACCOUNT_NAME = 'seed-test-agent';

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizeApiKeySecret(raw: string | undefined): string | undefined {
  if (!raw) return raw;
  // Expand literal \n sequences (single-line .env storage) and strip \r
  // (Windows CRLF in dotenv values).
  const key = raw.replace(/\\n/g, '\n').replace(/\r/g, '');
  log(`[debug] apiKeySecret length=${key.length} head="${key.slice(0, 40)}" tail="${key.slice(-40).trimEnd()}"`);

  if (key.includes('-----BEGIN EC PRIVATE KEY-----')) {
    // CDP SDK (jose v6) requires PKCS#8. Convert using pure Buffer arithmetic
    // so we never call createPrivateKey, which fails on some Windows OpenSSL builds.
    const pkcs8 = sec1ToP256Pkcs8Pem(key);
    log(`[debug] converted to PKCS#8, length=${pkcs8.length}`);
    return pkcs8;
  }

  return key;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function log(msg: string) {
  process.stdout.write(`${msg}\n`);
}

function ok(msg: string) {
  log(`  ✓ ${msg}`);
}

function fail(msg: string) {
  log(`  ✗ ${msg}`);
}

// ── CDP client + test wallet ──────────────────────────────────────────────────

async function setupTestAgent(cdp: CdpClient) {
  log('\n── Setting up test agent wallet ──────────────────────────────────────────');

  const agent = await cdp.evm.getOrCreateAccount({ name: AGENT_ACCOUNT_NAME });
  ok(`Test agent: ${agent.address}`);

  // Fund with ETH for gas + USDC for payments
  log('  Requesting testnet ETH from faucet…');
  try {
    const { transactionHash: ethTx } = await cdp.evm.requestFaucet({
      address: agent.address,
      network: NETWORK,
      token: 'eth',
    });
    ok(`ETH faucet tx: ${ethTx}`);
  } catch (err: unknown) {
    // Faucet rate-limits repeat requests — not fatal if already funded
    const msg = err instanceof Error ? err.message : String(err);
    log(`  (ETH faucet skipped: ${msg})`);
  }

  log('  Requesting testnet USDC from faucet…');
  try {
    const { transactionHash: usdcTx } = await cdp.evm.requestFaucet({
      address: agent.address,
      network: NETWORK,
      token: 'usdc',
    });
    ok(`USDC faucet tx: ${usdcTx}`);
    log('  Waiting 15 s for faucet tx to confirm…');
    await sleep(15_000);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`  (USDC faucet skipped: ${msg})`);
    await sleep(2_000); // still wait a bit in case funded from prior run
  }

  return agent;
}

// ── x402 HTTP client ──────────────────────────────────────────────────────────

function buildX402Client(
  agent: Awaited<ReturnType<CdpClient['evm']['getOrCreateAccount']>>,
): x402HTTPClient {
  // Adapt the CDP ServerAccount to x402's ClientEvmSigner interface.
  // Both use EIP-712 typed data signing with the same field names.
  const signer = {
    address: agent.address as `0x${string}`,
    signTypedData: async (params: {
      domain: Record<string, unknown>;
      types: Record<string, unknown>;
      primaryType: string;
      message: Record<string, unknown>;
    }) => {
      // CDP's signTypedData accepts the same shape as viem's TypedDataDefinition
      const sig = await (agent.signTypedData as (p: typeof params) => Promise<`0x${string}`>)(params);
      return sig;
    },
  };

  const core = new x402Client();
  registerExactEvmScheme(core, { signer });

  return new x402HTTPClient(core);
}

// ── Per-endpoint test runner ──────────────────────────────────────────────────

interface Endpoint {
  label: string;
  method: 'GET' | 'POST';
  path: string;
  body?: Record<string, unknown>;
}

const ENDPOINTS: Endpoint[] = [
  { label: 'Sentiment (AAPL)',     method: 'GET',  path: '/api/v1/sentiment/AAPL' },
  { label: 'Company (stripe.com)', method: 'GET',  path: '/api/v1/company/stripe.com' },
  { label: 'Email enrich',         method: 'GET',  path: '/api/v1/enrich/email/test@example.com' },
  { label: 'News summary',         method: 'GET',  path: '/api/v1/news/summary?q=AI+regulation' },
  { label: 'Data extract',         method: 'POST', path: '/api/v1/extract',
    body: { url: 'https://example.com' } },
  { label: 'Contract analyzer',    method: 'POST', path: '/api/v1/analyze/contract',
    body: { text: 'This is a test agreement between Party A and Party B.' } },
  { label: 'Code reviewer',        method: 'POST', path: '/api/v1/review/code',
    body: { code: 'def hello():\n    print("hi")', language: 'python' } },
  { label: 'Research synthesizer', method: 'POST', path: '/api/v1/research',
    body: { question: 'What is x402?', depth: 'quick' } },
];

async function testEndpoint(
  endpoint: Endpoint,
  httpClient: x402HTTPClient,
): Promise<void> {
  const url = `${BASE_URL}${endpoint.path}`;
  const label = `[${endpoint.method}] ${endpoint.label}`;

  log(`\n── ${label} ─────────────────────────────────────────────────────────────`);

  // ── Step 1: Unpaid request ──────────────────────────────────────────────────
  let unpaidResponse: AxiosResponse;
  try {
    const cfg: AxiosRequestConfig = {
      method: endpoint.method,
      url,
      data: endpoint.body,
      validateStatus: () => true, // don't throw on non-2xx
    };
    unpaidResponse = await axios(cfg);

    if (unpaidResponse.status === 402) {
      ok(`Unpaid → 402 Payment Required (as expected)`);
    } else {
      fail(`Unpaid → unexpected status ${unpaidResponse.status} (expected 402)`);
      return;
    }
  } catch (err: unknown) {
    fail(`Unpaid request failed: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  // ── Step 2: Parse payment requirement ──────────────────────────────────────
  let paymentRequired;
  try {
    const headers = unpaidResponse.headers as Record<string, string | undefined>;
    paymentRequired = httpClient.getPaymentRequiredResponse(
      (name) => headers[name.toLowerCase()] ?? null,
      unpaidResponse.data,
    );
    const req = (paymentRequired.accepts as unknown as Array<Record<string, string>>)[0];
    const usdcAmt = req
      ? (parseInt(req.maxAmountRequired ?? req.amount ?? '0') / 1e6).toFixed(4)
      : '?';
    ok(`Payment requirement: $${usdcAmt} USDC on ${req?.network ?? '?'}`);
  } catch (err: unknown) {
    fail(`Failed to parse payment requirement: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  // ── Step 3: Create payment payload ─────────────────────────────────────────
  let paymentHeaders: Record<string, string>;
  try {
    const payload = await httpClient.createPaymentPayload(paymentRequired);
    paymentHeaders = httpClient.encodePaymentSignatureHeader(payload);
    ok('Payment payload signed');
  } catch (err: unknown) {
    fail(`Failed to create payment payload: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  // ── Step 4: Paid request ───────────────────────────────────────────────────
  try {
    const cfg: AxiosRequestConfig = {
      method: endpoint.method,
      url,
      data: endpoint.body,
      headers: paymentHeaders,
      validateStatus: () => true,
    };
    const paidResponse = await axios(cfg);

    if (paidResponse.status === 200) {
      ok(`Paid → 200 OK`);
      // Print a short preview of the response
      const preview = JSON.stringify(paidResponse.data).slice(0, 160);
      log(`     ${preview}${preview.length === 160 ? '…' : ''}`);
    } else {
      fail(`Paid → unexpected status ${paidResponse.status}`);
      log(`     ${JSON.stringify(paidResponse.data).slice(0, 200)}`);
    }
  } catch (err: unknown) {
    fail(`Paid request failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  log('╔════════════════════════════════════════════════════════╗');
  log('║  AiScale Agent Services — Seed Transaction Runner     ║');
  log('╚════════════════════════════════════════════════════════╝');
  log(`Target: ${BASE_URL}`);
  log(`Network: ${NETWORK}`);

  // Validate env
  const keyId     = process.env.CDP_API_KEY_ID;
  const keySecret = normalizeApiKeySecret(process.env.CDP_API_KEY_SECRET);
  const walletSec = process.env.CDP_WALLET_SECRET;

  if (!keyId || !keySecret || !walletSec) {
    log('\nError: CDP_API_KEY_ID, CDP_API_KEY_SECRET, and CDP_WALLET_SECRET must be set.');
    process.exit(1);
  }

  const cdp = new CdpClient({
    apiKeyId:     keyId,
    apiKeySecret: keySecret,
    walletSecret: walletSec,
  });

  // 1. Create / retrieve test agent + fund it
  const agent = await setupTestAgent(cdp);

  // 2. Build x402 HTTP client backed by the test agent wallet
  const httpClient = buildX402Client(agent);

  // 3. Run each endpoint
  const results = { passed: 0, failed: 0 };
  for (const endpoint of ENDPOINTS) {
    const before = results.failed;
    await testEndpoint(endpoint, httpClient);
    if (results.failed === before) results.passed++;
    else results.failed++;
  }

  // 4. Summary
  log('\n══════════════════════════════════════════════════════════');
  log(`  Results: ${results.passed} passed / ${ENDPOINTS.length} total`);
  log('══════════════════════════════════════════════════════════\n');

  process.exit(results.failed > 0 ? 1 : 0);
}

main().catch((err) => {
  log(`\nFatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
