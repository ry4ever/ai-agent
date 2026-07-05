import { Request, Response } from 'express';
import { getRevenueStats } from '../db/queries';

/**
 * Revenue aggregates over a time window. Protected by the requireAdmin
 * middleware (mounted on the route), which checks ADMIN_API_KEY.
 */
export async function statsHandler(req: Request, res: Response): Promise<void> {
  const days = clampDays(req.query.days);
  const stats = await getRevenueStats(days);

  res.json({
    windowDays: days,
    wallet: process.env.WALLET_ADDRESS ?? 'NOT SET',
    network: process.env.NETWORK ?? 'base-sepolia',
    ...stats,
    generatedAt: new Date().toISOString(),
  });
}

function clampDays(raw: unknown): number {
  const n = parseInt(String(raw ?? '7'), 10);
  if (!Number.isFinite(n) || n <= 0) return 7;
  if (n > 365) return 365;
  return n;
}
