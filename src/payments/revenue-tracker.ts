import { Request, Response, NextFunction } from 'express';
import { insertTransaction, upsertDailyRevenue } from '../db/queries';
import { paymentLogger } from '../middleware/logger';

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

    // Non-blocking DB writes — don't slow down the response
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
    ]).catch((err) => {
      // Log but don't fail the request
      paymentLogger({
        txHash,
        agentAddress,
        endpoint,
        amountUSDC,
      });
    });

    paymentLogger({ txHash, agentAddress, endpoint, amountUSDC });
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
