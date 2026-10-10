import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';
import { validateBody } from '../src/middleware/validate-body';

function mockReq(body: unknown): Request {
  return { body } as Request;
}

function mockRes(): Response & { _status?: number; _json?: unknown } {
  const r: Record<string, unknown> = {};
  r.status = vi.fn((code: number) => { r._status = code; return r; });
  r.json = vi.fn((payload: unknown) => { r._json = payload; return r; });
  return r as unknown as Response & { _status?: number; _json?: unknown };
}

describe('validateBody middleware', () => {
  const Schema = z.object({
    name: z.string().min(1),
    count: z.number().int().optional(),
  });

  it('calls next() on a valid body', () => {
    const next = vi.fn() as unknown as NextFunction;
    const req = mockReq({ name: 'ok', count: 3 });
    const res = mockRes();
    validateBody(Schema)(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('replaces req.body with the parsed+stripped version', () => {
    const next = vi.fn() as unknown as NextFunction;
    // Extra keys should be stripped by zod's default behaviour on z.object
    const req = mockReq({ name: 'ok', extra: 'should-be-removed' });
    const res = mockRes();
    validateBody(Schema)(req, res, next);
    expect(req.body).toEqual({ name: 'ok' });
    expect((req.body as Record<string, unknown>).extra).toBeUndefined();
  });

  it('rejects an invalid body with 400 and does not call next', () => {
    const next = vi.fn() as unknown as NextFunction;
    const req = mockReq({ name: '' }); // violates min(1)
    const res = mockRes();
    validateBody(Schema)(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res._json).toMatchObject({ error: 'Invalid request' });
    expect((res._json as { details: unknown[] }).details).toBeInstanceOf(Array);
  });

  it('rejects a missing body (undefined) with 400', () => {
    const next = vi.fn() as unknown as NextFunction;
    const req = mockReq(undefined);
    const res = mockRes();
    validateBody(Schema)(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
