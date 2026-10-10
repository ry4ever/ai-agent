import { createHash } from 'crypto';
import type { AfterSettleHook, SettleResultContext } from '@x402/core/server';
import { insertTransaction, upsertDailyRevenue } from '../db/queries';
import { paymentLogger, logger } from '../middleware/logger';
import { routeConfigs } from '../config/x402-bazaar-config';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

// Upper bound on how long we'll block the paid response waiting for the two
// bookkeeping writes to settle. The on-chain settle has already happened by
// the time this hook runs — we must never fail the paid response over DB
// bookkeeping. 2s balances DB latency against SIGTERM drain safety.
const DB_WRITE_TIMEOUT_MS = 2000;

// Analytics labels are derived from routeConfigs (the single source of truth).
// We strip trailing /:param segments so '/api/v1/sentiment/:ticker' becomes
// '/api/v1/sentiment' — same convention the Express mounts used before.
interface EndpointRule {
  method: string;
  pattern: RegExp;
  label: string;
}
const SERVICE_ENDPOINT_RULES: EndpointRule[] = Object.keys(routeConfigs).map((key) => {
  const [method, rawPath] = key.split(' ');
  const pattern = new RegExp('^' + rawPath.replace(/:[^/]+/g, '[^/]+') + '$');
  const label = rawPath.replace(/(\/:[^/]+)+$/, '');
  return { method: method.toUpperCase(), pattern, label };
});

function labelFor(method: string, path: string): string {
  const rule = SERVICE_ENDPOINT_RULES.find((r) => r.method === method && r.pattern.test(path));
  return rule?.label ?? path;
}

/**
 * Resource-server AfterSettleHook: records revenue for payments that
 * actually settled on-chain. Replaces the old `trackRevenue` Express
 * middleware, which ran between the paywall and the handler and
 * therefore recorded a `transactions` row for every paid request,
 * including those the paywall then cancelled on a 4xx/5xx response.
 *
 * This hook only fires for successful settlements, so cancelled
 * payments no longer leave ghost DB rows.
 */
export const revenueTrackerHook: AfterSettleHook = async (ctx: SettleResultContext): Promise<void> => {
  // Defensive: AfterSettleHook is already scoped to post-settle, but a
  // scheme could in principle surface a non-success result here.
  if (!ctx.result.success) return;

  const transport = ctx.transportContext as
    | { request?: { method?: string; path?: string; paymentHeader?: string } }
    | undefined;
  const method = (transport?.request?.method ?? 'UNKNOWN').toUpperCase();
  const path = transport?.request?.path ?? '';
  const endpoint = labelFor(method, path);

  // Agent address comes from the facilitator's verified payer first, then
  // the signed EIP-3009 `authorization.from` as a fallback (same source;
  // defence in depth against the facilitator ever omitting `payer`).
  const payload = ctx.paymentPayload.payload as
    | { authorization?: { from?: string } }
    | undefined;
  const agentAddress = (ctx.result.payer ?? payload?.authorization?.from ?? ZERO_ADDRESS).toLowerCase();

  const txHash = (ctx.result.transaction || deriveTxHashFallback(transport?.request?.paymentHeader)).toLowerCase();

  // Prefer the actually-settled amount (upto scheme bills by usage); fall
  // back to the authorised max. The `requirements` type is intentionally
  // scheme-agnostic here, so narrow with an inline cast.
  const amountMicroUSDC =
    ctx.result.amount ??
    (ctx.requirements as unknown as { amount?: string; maxAmountRequired?: string }).amount ??
    (ctx.requirements as unknown as { maxAmountRequired?: string }).maxAmountRequired ??
    '0';
  const amountUSDC = parseInt(amountMicroUSDC, 10) / 1_000_000;

  const logCtx = { txHash, agentAddress, endpoint, amountUSDC };

  const insertPromise = insertTransaction({
    tx_hash: txHash,
    agent_address: agentAddress,
    service_endpoint: endpoint,
    amount_usdc: amountUSDC,
    metadata: {
      settled_via: 'x402_after_settle_hook',
      network: ctx.result.network,
      method,
      path,
    },
  })
    .then(() => {
      paymentLogger(logCtx);
    })
    .catch((err) => {
      logger.error('Transaction insert failed', {
        event: 'transaction_insert_error',
        ...logCtx,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
    });

  const upsertPromise = upsertDailyRevenue({
    service_endpoint: endpoint,
    amount_usdc: amountUSDC,
    agent_address: agentAddress,
  }).catch((err) => {
    logger.error('Daily revenue upsert failed', {
      event: 'revenue_upsert_error',
      ...logCtx,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
  });

  try {
    await Promise.race([
      Promise.allSettled([insertPromise, upsertPromise]),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('db_write_timeout')), DB_WRITE_TIMEOUT_MS);
      }),
    ]);
  } catch {
    logger.error('Revenue tracking writes exceeded timeout', {
      event: 'revenue_write_timeout',
      ...logCtx,
      timeout_ms: DB_WRITE_TIMEOUT_MS,
    });
  }
};

// Only used when the facilitator omitted result.transaction, which shouldn't
// happen for a successful settlement — kept as a last-ditch dedupe key for
// the UNIQUE(tx_hash) constraint rather than inventing a time-based id.
function deriveTxHashFallback(paymentHeader: string | undefined): string {
  if (!paymentHeader) {
    return '0x' + createHash('sha256').update('missing_settlement_tx:' + Date.now()).digest('hex');
  }
  return '0x' + createHash('sha256').update(paymentHeader).digest('hex');
}

export const EXPORTED_FOR_TESTS = { labelFor, SERVICE_ENDPOINT_RULES };
