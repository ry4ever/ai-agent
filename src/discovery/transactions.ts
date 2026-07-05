import { Request, Response } from 'express';
import { getTransactions } from '../db/queries';

/**
 * Paginated list of recorded payments. Protected by the requireAdmin
 * middleware (mounted on the route).
 *
 * Query params:
 *   - limit   (1..200, default 50)
 *   - offset  (default 0)
 *   - service (optional, e.g. "/api/v1/research")
 */
export async function transactionsHandler(req: Request, res: Response): Promise<void> {
  const limit = parseOptionalInt(req.query.limit);
  const offset = parseOptionalInt(req.query.offset);
  const service = typeof req.query.service === 'string' ? req.query.service : undefined;

  const result = await getTransactions({ limit, offset, service });

  res.json({
    wallet: process.env.WALLET_ADDRESS ?? 'NOT SET',
    network: process.env.NETWORK ?? 'base-sepolia',
    count: result.transactions.length,
    total: result.total,
    limit: result.limit,
    offset: result.offset,
    ...(service ? { service } : {}),
    transactions: result.transactions,
    generatedAt: new Date().toISOString(),
  });
}

function parseOptionalInt(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const n = parseInt(String(raw), 10);
  return Number.isFinite(n) ? n : undefined;
}
