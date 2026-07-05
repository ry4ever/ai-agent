import { Request, Response, NextFunction } from 'express';

/**
 * Requires a valid admin key for protected routes (e.g. /stats*).
 *
 * The key may be supplied via either:
 *   - Authorization: Bearer <key>
 *   - x-admin-key: <key>
 *
 * Fails closed: if ADMIN_API_KEY is not configured the endpoint returns 503,
 * so a protected route can never accidentally become public.
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const configuredKey = process.env.ADMIN_API_KEY;

  if (!configuredKey) {
    res.status(503).json({ error: 'Endpoint disabled — ADMIN_API_KEY is not set' });
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

  next();
}

function timingSafeEqual(a: string, b: string): boolean {
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
