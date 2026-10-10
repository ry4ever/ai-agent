import type { Request, Response, NextFunction } from 'express';
import type { ZodSchema } from 'zod';

/**
 * Pre-paywall body validation. Mounted BEFORE the x402 paywall on every
 * paid POST route, so a bad body:
 *   1. Never triggers x402 signature verification (saves a facilitator RTT).
 *   2. Never flows through `trackRevenue`, which otherwise records a DB row
 *      for a payment that the paywall will then cancel on the 400.
 *
 * The handler keeps its own `safeParse` as defence-in-depth: if a new paid
 * route is added without wiring this middleware, the handler still rejects
 * the bad body — it just does so after the paywall has already round-tripped.
 */
export function validateBody(schema: ZodSchema): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({
        error: 'Invalid request',
        details: result.error.errors,
      });
      return;
    }
    // Replace req.body with the parsed+coerced version so handlers see the
    // normalised shape (defaults applied, strings coerced, extra keys stripped).
    req.body = result.data;
    next();
  };
}
