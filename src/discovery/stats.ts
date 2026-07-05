import { Request, Response } from 'express';
import { getRevenueStats } from '../db/queries';

/**
 * Admin-only revenue stats endpoint.
 *
 * Auth: requires ADMIN_API_KEY to be set, supplied by the caller via either
 *   - Authorization: Bearer <key>
 *   - x-admin-key: <key>
 *
 * Fails closed: if ADMIN_API_KEY is not configured the endpoint returns 503,
 * so it can never accidentally expose data as a public route.
 */
export async function statsHandler(req: Request, res: Response): Promise<void> {
  const configuredKey = process.env.ADMIN_API_KEY;

  if (!configuredKey) {
    res.status(503).json({ error: 'Stats endpoint disabled — ADMIN_API_KEY is not set' });
    return;
  }

  const provided =
    (req.header('x-admin-key') ?? '').trim() ||
    (req.header('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();

  // Timing-safe comparison to avoid leaking the key via response timing.
  if (provided.length !== configuredKey.length || !timingSafeEqual(provided, configuredKey)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

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

function timingSafeEqual(a: string, b: string): boolean {
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
