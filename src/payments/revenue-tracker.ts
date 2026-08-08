import { createHash } from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { insertTransaction, upsertDailyRevenue } from '../db/queries';
import { paymentLogger, logger } from '../middleware/logger';

// This middleware runs after a successful x402 payment verification.
// It logs the payment to the database and updates daily revenue aggregates.
export function trackRevenue(
  endpoint: string,
  priceInMicroUSDC: string
) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    // Extract payment info from request (populated by x402 middleware)
    const paymentHeader = req.headers['x-payment'] as string | undefined;
    const agentAddress = (req.headers['x-agent-address'] as string) ?? '0x0000000000000000000000000000000000000000';

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

    // Decoupled, non-blocking DB writes. Each operation runs independently
    // with its own error handler. Previously both were bundled in Promise.all,
    // so a failure in insertTransaction (e.g. a tx_hash collision) caused the
    // whole promise to reject and overshadowed upsertDailyRevenue — which
    // still succeeded silently in the background. That decoupling bug is why
    // revenue_daily filled up while the transactions table stayed nearly empty.
    // The user has already paid, so we must never fail the request over logging.
    insertTransaction({
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

    upsertDailyRevenue({
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

    next();
  };
}

const EVM_TX_HASH_RE = /^0x[a-fA-F0-9]{64}$/;

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
