import { Request, Response, NextFunction } from 'express';
import { insertTransaction, upsertDailyRevenue } from '../db/queries';
import { paymentLogger, logger } from '../middleware/logger';

// This middleware runs after a successful x402 payment verification.
// It logs the payment to the database and updates daily revenue aggregates.
export function trackRevenue(
  endpoint: string,
  priceInMicroUSDC: string
) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    // Extract payment info from request (populated by x402 middleware)
    const paymentHeader = req.headers['x-payment'] as string | undefined;
    const agentAddress = (req.headers['x-agent-address'] as string) ?? '0x0000000000000000000000000000000000000000';

    // Convert micro-USDC to USDC decimal
    const amountUSDC = parseInt(priceInMicroUSDC) / 1_000_000;

    // Use payment hash or generate a tracking ID
    const txHash = paymentHeader
      ? extractTxHash(paymentHeader)
      : `local_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    // Non-blocking DB writes — don't slow down the response, but surface failures.
    // Previously the .catch() swallowed `err` and logged a success-looking
    // "Payment received" message, masking a disconnected database entirely.
    Promise.all([
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
      }),
      upsertDailyRevenue({
        service_endpoint: endpoint,
        amount_usdc: amountUSDC,
        agent_address: agentAddress,
      }),
    ]).then(() => {
      paymentLogger({ txHash, agentAddress, endpoint, amountUSDC });
    }).catch((err) => {
      // Log the actual error so the "disconnected state" is visible in logs.
      // Don't fail the request — the user already paid and should get their response.
      logger.error('Transaction DB write failed', {
        event: 'payment_db_error',
        txHash,
        agentAddress,
        endpoint,
        amountUSDC,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
    });

    next();
  };
}

function extractTxHash(paymentHeader: string): string {
  try {
    // x402 payment header is a base64-encoded JSON object
    const decoded = JSON.parse(Buffer.from(paymentHeader, 'base64').toString());
    return decoded.transaction ?? decoded.txHash ?? decoded.hash ?? paymentHeader.slice(0, 66);
  } catch {
    return paymentHeader.slice(0, 66);
  }
}
