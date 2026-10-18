import type { Request, Response, NextFunction } from 'express';
import { SERVICE_DEFINITIONS } from '../config/services';

/**
 * Returns 405 Method Not Allowed (with an `Allow` header) when a request
 * hits a KNOWN paid-route path with the WRONG HTTP method, instead of the
 * generic 404 that Express sends by default.
 *
 * Motivation: external x402 indexers (e.g. the Nitrograph listing observed
 * on 2026-10-17) health-probe every endpoint with a hardcoded method,
 * ignoring the `bazaar.info.input.method` field in our 402 response. When
 * they probe `POST /api/v1/news/summary` on our GET-only route they get a
 * bare 404 and mark the service "down". A 405 with `Allow: GET` is the
 * spec-correct answer and tells any probing client what to try next.
 *
 * Mount AFTER all paid-route handlers so this fires only on misses.
 * Non-paid paths (/, /health, /.well-known/*, /mcp, /stats, …) are left
 * alone and fall through to Express's default 404.
 */
interface Rule {
  method: string;
  pattern: RegExp;
}

// Derive one regex per paid route from the single source of truth.
const RULES: Rule[] = SERVICE_DEFINITIONS.map((svc) => ({
  method: svc.method.toUpperCase(),
  pattern: new RegExp('^' + svc.endpoint.replace(/:[^/]+/g, '[^/]+') + '$'),
}));

export function methodNotAllowedHandler(req: Request, res: Response, next: NextFunction): void {
  const allowed = new Set<string>();
  for (const r of RULES) {
    if (r.pattern.test(req.path)) allowed.add(r.method);
  }

  // Not a known paid-route path — let the default 404 handle it.
  if (allowed.size === 0) {
    next();
    return;
  }

  // Correct method but the real handler didn't send a response. Shouldn't
  // happen in practice (we're mounted after the paid handlers) but if it
  // does, don't shadow a real request.
  if (allowed.has(req.method.toUpperCase())) {
    next();
    return;
  }

  const allowHeader = Array.from(allowed).sort().join(', ');
  res.setHeader('Allow', allowHeader);
  res.status(405).json({
    error: 'Method Not Allowed',
    message: `This endpoint only accepts ${allowHeader}. Got ${req.method}.`,
    allowed: Array.from(allowed).sort(),
    docs: {
      openapi: '/openapi.json',
      x402_registry: '/.well-known/x402',
    },
  });
}
