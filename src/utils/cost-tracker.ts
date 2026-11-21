/**
 * Per-request cost accumulator.
 *
 * A handler calls `recordEstimatedCost(req, {provider, modelOrSource, usd})`
 * once per billable sub-call it makes (Anthropic, Hunter, Clearbit, …). The
 * AfterSettleHook later reads the accumulated breakdown off the same `req`
 * via `readCostBreakdown(req)` and persists it into `transactions.metadata`
 * so revenue and cost sit on the same row.
 *
 * Why a WeakMap keyed on req: express req objects are per-request and GC'd
 * when the response is fully sent, so this map auto-clears without any
 * explicit teardown. Totals are kept out of req.locals so handler code and
 * logs that walk res.locals don't accidentally surface or mutate them.
 */

import type { Request } from 'express';

export interface CostEntry {
  /** Which external service was billed. e.g. "anthropic", "hunter", "clearbit". */
  provider: string;
  /** Model slug (LLMs) or endpoint name (data APIs) that incurred the cost. */
  source: string;
  /** Estimated USD cost of this one sub-call. */
  usd: number;
  /** Optional detail. For LLM calls, the token counts; for others, provider-specific. */
  detail?: Record<string, unknown>;
}

export interface CostBreakdown {
  totalUSD: number;
  entries: CostEntry[];
}

const costs = new WeakMap<Request, CostEntry[]>();

/**
 * Record one estimated-cost entry against the current request. Safe to call
 * multiple times per request (totals accumulate). A null `usd` (meaning cost
 * couldn't be estimated — e.g. Anthropic response lacked usage) is skipped
 * rather than persisted as zero.
 */
export function recordEstimatedCost(req: Request, entry: Omit<CostEntry, 'usd'> & { usd: number | null }): void {
  if (entry.usd === null || !Number.isFinite(entry.usd)) return;
  const list = costs.get(req) ?? [];
  list.push({ ...entry, usd: entry.usd });
  costs.set(req, list);
}

/**
 * Called by the AfterSettleHook to read the accumulated cost breakdown for
 * this request. Returns `null` when no handler recorded anything, so the hook
 * persists `null` into metadata rather than `{totalUSD: 0}` (which would be
 * indistinguishable from a real zero-cost call).
 */
export function readCostBreakdown(req: Request | undefined): CostBreakdown | null {
  if (!req) return null;
  const entries = costs.get(req);
  if (!entries || entries.length === 0) return null;
  return {
    totalUSD: entries.reduce((sum, e) => sum + e.usd, 0),
    entries,
  };
}
