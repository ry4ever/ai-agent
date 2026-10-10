import { createHash } from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { insertTransaction, upsertDailyRevenue } from '../db/queries';
import { paymentLogger, logger } from '../middleware/logger';

// Upper bound on how long we'll block the paid response waiting for the two
// bookkeeping writes to settle. The paywall has already settled on-chain by
// the time this middleware runs, so the service MUST execute — but we also
// want the writes to complete before SIGTERM drains the pool. 2s balances
// both: typical write is <50ms, SIGTERM drain cuts us off cleanly.
const DB_WRITE_TIMEOUT_MS = 2000;

// This middleware runs after a successful x402 payment verification.
// It logs the payment to the database and updates daily revenue aggregates.
export function trackRevenue(
  endpoint: string,
  priceInMicroUSDC: string
) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    // Extract payment info from request (populated by x402 middleware)
    const paymentHeader = req.headers['x-payment'] as string | undefined;
    // The agent address is the EIP-3009 `authorization.from` inside the signed
    // X-PAYMENT payload — the facilitator already verified the signature, so
    // this field is authentic. Previously we read `x-agent-address` from the
    // request headers, which was attacker-controlled: any caller could set it
    // to anything, poisoning per-agent analytics and the `unique_agents` count.
    const extractedAddress = paymentHeader ? extractAgentAddress(paymentHeader) : null;
    const agentAddress = extractedAddress ?? ZERO_ADDRESS;
    if (paymentHeader && !extractedAddress) {
      logger.warn('Payment header present but no payer address could be extracted', {
        event: 'unparseable_payment_payload',
        endpoint,
      });
    }

    // Convert micro-USDC to USDC decimal
    const amountUSDC = parseInt(priceInMicroUSDC) / 1_000_000;

    // This middleware runs after the paywall, so X-PAYMENT should always be
    // present. If it isn't, something is misconfigured (e.g. a route mounted
    // with trackRevenue but no paywall ahead of it) — surface it loudly rather
    // than silently inventing a non-deterministic id that defeats the tx_hash
    // dedupe in insertTransaction.
    const txHash = paymentHeader
      ? extractTxHash(paymentHeader)
      : `missing-payment_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    if (!paymentHeader) {
      logger.warn('Revenue recorded without an X-PAYMENT header — unexpected after paywall', {
        event: 'missing_payment_header',
        endpoint,
        method: req.method,
        path: req.path,
        agentAddress,
      });
    }

    const logCtx = { txHash, agentAddress, endpoint, amountUSDC };

    // Decoupled writes: each has its own catch handler so a tx_hash collision
    // in insertTransaction doesn't swallow a working upsertDailyRevenue (and
    // vice versa). The user has already paid, so we must never fail the request
    // over bookkeeping — but we DO wait for the writes (up to DB_WRITE_TIMEOUT_MS)
    // before releasing next() so (a) a healthy DB settles before response, and
    // (b) in-flight writes complete before SIGTERM drains the pool. Previously
    // these were fire-and-forget, which meant SIGTERM could abort them.
    const insertPromise = insertTransaction({
      tx_hash: txHash,
      agent_address: agentAddress,
      service_endpoint: endpoint,
      amount_usdc: amountUSDC,
      metadata: {
        method: req.method,
        path: req.path,
        userAgent: req.headers['user-agent'],
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

    // Promise.allSettled never rejects — the race only loses to the timeout.
    try {
      await Promise.race([
        Promise.allSettled([insertPromise, upsertPromise]),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('db_write_timeout')), DB_WRITE_TIMEOUT_MS);
        }),
      ]);
    } catch {
      // Writes keep running in the background; their own catch handlers log
      // the final outcome. We flag only that we gave up waiting so an op can
      // correlate slow responses with the DB.
      logger.error('Revenue tracking writes exceeded timeout', {
        event: 'revenue_write_timeout',
        ...logCtx,
        timeout_ms: DB_WRITE_TIMEOUT_MS,
      });
    }

    next();
  };
}

const EVM_TX_HASH_RE = /^0x[a-fA-F0-9]{64}$/;
const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/**
 * Extract the payer address from an x402 payment header.
 *
 * The USDC-on-Base scheme is EIP-3009 TransferWithAuthorization: the signed
 * payload is `{ ..., payload: { signature, authorization: { from, to, value,
 * validAfter, validBefore, nonce } } }`, where `authorization.from` is the
 * signer. Because the facilitator already verified the signature by the time
 * this function runs, the `from` field cannot be forged — the one on the
 * client header could.
 *
 * Falls back to a shallow recursive search for a 20-byte-hex `from` field if
 * the exact EIP-3009 shape doesn't match (future-proofing for Permit2 and
 * other schemes). Returns null if nothing usable is found.
 */
export function extractAgentAddress(paymentHeader: string): string | null {
  const decoded = tryDecodeB64Json(paymentHeader);
  if (decoded === null || typeof decoded !== 'object') return null;

  // EIP-3009 fast-path: PaymentPayloadV1.payload.authorization.from
  const payload = (decoded as { payload?: unknown }).payload;
  if (payload && typeof payload === 'object') {
    const auth = (payload as { authorization?: unknown }).authorization;
    if (auth && typeof auth === 'object') {
      const from = (auth as { from?: unknown }).from;
      if (typeof from === 'string' && EVM_ADDRESS_RE.test(from)) {
        return from.toLowerCase();
      }
    }
  }

  // Fallback: any nested `from` field matching an EVM address.
  const fallback = findFromAddress(decoded);
  return fallback ? fallback.toLowerCase() : null;
}

function findFromAddress(node: unknown): string | null {
  if (!node || typeof node !== 'object') return null;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === 'from' && typeof value === 'string' && EVM_ADDRESS_RE.test(value)) {
      return value;
    }
    const nested = findFromAddress(value);
    if (nested) return nested;
  }
  return null;
}

/**
 * Extract a transaction hash from an x402 payment header.
 *
 * The header is a base64-encoded JSON payment payload. The real on-chain tx
 * hash is usually nested deep inside `payload` (not at the top level), so we
 * recursively search for any value that looks like an EVM tx hash.
 *
 * If none is found, we derive a deterministic unique id by hashing the full
 * payment proof with sha256. This guarantees:
 *   - distinct payments → distinct hashes (no collisions on the UNIQUE index)
 *   - replayed payments → same hash (caught by ON CONFLICT DO NOTHING)
 *   - fits VARCHAR(66): '0x' + 64 hex chars = 66
 */
export function extractTxHash(paymentHeader: string): string {
  const decoded = tryDecodeB64Json(paymentHeader);
  if (decoded !== null) {
    const found = findEvmTxHash(decoded);
    if (found) {
      return found.toLowerCase();
    }
  }
  return '0x' + createHash('sha256').update(paymentHeader).digest('hex');
}

function tryDecodeB64Json(s: string): unknown {
  try {
    return JSON.parse(Buffer.from(s, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

function findEvmTxHash(node: unknown): string | null {
  if (typeof node === 'string') {
    return EVM_TX_HASH_RE.test(node) ? node : null;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findEvmTxHash(item);
      if (found) return found;
    }
    return null;
  }
  if (node && typeof node === 'object') {
    for (const value of Object.values(node as Record<string, unknown>)) {
      const found = findEvmTxHash(value);
      if (found) return found;
    }
  }
  return null;
}
