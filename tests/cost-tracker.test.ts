import { describe, it, expect } from 'vitest';
import type { Request } from 'express';
import { recordEstimatedCost, readCostBreakdown } from '../src/utils/cost-tracker';

function makeReq(): Request {
  return {} as unknown as Request;
}

describe('cost-tracker', () => {
  it('returns null when nothing has been recorded for a request', () => {
    expect(readCostBreakdown(makeReq())).toBeNull();
  });

  it('returns null for an undefined request (defensive for the hook path)', () => {
    expect(readCostBreakdown(undefined)).toBeNull();
  });

  it('accumulates entries and sums the total', () => {
    const req = makeReq();
    recordEstimatedCost(req, { provider: 'anthropic', source: 'claude-sonnet-4-6', usd: 0.004 });
    recordEstimatedCost(req, { provider: 'anthropic', source: 'claude-haiku-4-5-20251001', usd: 0.0005 });
    const breakdown = readCostBreakdown(req);
    expect(breakdown).not.toBeNull();
    expect(breakdown!.totalUSD).toBeCloseTo(0.0045, 6);
    expect(breakdown!.entries).toHaveLength(2);
    expect(breakdown!.entries[0].source).toBe('claude-sonnet-4-6');
  });

  it('skips entries with null usd (unknown cost) rather than recording zero', () => {
    const req = makeReq();
    recordEstimatedCost(req, { provider: 'anthropic', source: 'claude-sonnet-4-6', usd: null });
    expect(readCostBreakdown(req)).toBeNull();
  });

  it('skips entries with non-finite usd', () => {
    const req = makeReq();
    recordEstimatedCost(req, { provider: 'x', source: 'y', usd: Number.POSITIVE_INFINITY });
    recordEstimatedCost(req, { provider: 'x', source: 'y', usd: Number.NaN });
    expect(readCostBreakdown(req)).toBeNull();
  });

  it('keeps entries per-request (no leakage between requests)', () => {
    const a = makeReq();
    const b = makeReq();
    recordEstimatedCost(a, { provider: 'anthropic', source: 's', usd: 0.01 });
    expect(readCostBreakdown(a)!.totalUSD).toBeCloseTo(0.01, 6);
    expect(readCostBreakdown(b)).toBeNull();
  });

  it('preserves the optional detail payload on each entry', () => {
    const req = makeReq();
    recordEstimatedCost(req, {
      provider: 'anthropic',
      source: 'claude-sonnet-4-6',
      usd: 0.002,
      detail: { endpoint: '/api/v1/review/code', input_tokens: 500, output_tokens: 200 },
    });
    const entry = readCostBreakdown(req)!.entries[0];
    expect(entry.detail).toEqual({
      endpoint: '/api/v1/review/code',
      input_tokens: 500,
      output_tokens: 200,
    });
  });
});
