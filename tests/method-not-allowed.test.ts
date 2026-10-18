import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { methodNotAllowedHandler } from '../src/middleware/method-not-allowed';

function mockReq(method: string, path: string): Request {
  return { method, path } as Request;
}
function mockRes(): Response & { _status?: number; _json?: unknown; _headers: Record<string, string> } {
  const r: Record<string, unknown> = { _headers: {} };
  r.status = vi.fn((code: number) => { r._status = code; return r; });
  r.json = vi.fn((p: unknown) => { r._json = p; return r; });
  r.setHeader = vi.fn((name: string, value: string) => {
    (r._headers as Record<string, string>)[name] = value;
    return r;
  });
  return r as unknown as Response & { _status?: number; _json?: unknown; _headers: Record<string, string> };
}

describe('methodNotAllowedHandler', () => {
  it('returns 405 with Allow: GET when POST hits a GET-only paid route', () => {
    const next = vi.fn() as unknown as NextFunction;
    const req = mockReq('POST', '/api/v1/news/summary');
    const res = mockRes();
    methodNotAllowedHandler(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(405);
    expect(res._headers.Allow).toBe('GET');
    expect((res._json as { allowed: string[] }).allowed).toEqual(['GET']);
    expect((res._json as { message: string }).message).toContain('GET');
  });

  it('returns 405 with Allow: POST when GET hits a POST-only paid route', () => {
    const next = vi.fn() as unknown as NextFunction;
    const req = mockReq('GET', '/api/v1/analyze/contract');
    const res = mockRes();
    methodNotAllowedHandler(req, res, next);
    expect(res._status).toBe(405);
    expect(res._headers.Allow).toBe('POST');
  });

  it('matches parameterised paid-route paths (e.g. /api/v1/sentiment/:ticker)', () => {
    const next = vi.fn() as unknown as NextFunction;
    const req = mockReq('POST', '/api/v1/sentiment/AAPL');
    const res = mockRes();
    methodNotAllowedHandler(req, res, next);
    expect(res._status).toBe(405);
    expect(res._headers.Allow).toBe('GET');
  });

  it('calls next() on correct method (safety net; real handler would normally win first)', () => {
    const next = vi.fn() as unknown as NextFunction;
    const req = mockReq('GET', '/api/v1/sentiment/AAPL');
    const res = mockRes();
    methodNotAllowedHandler(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res._status).toBeUndefined();
  });

  it('calls next() for unknown paths (lets default 404 fire)', () => {
    const next = vi.fn() as unknown as NextFunction;
    const req = mockReq('POST', '/some/other/path');
    const res = mockRes();
    methodNotAllowedHandler(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res._status).toBeUndefined();
  });

  it('response body references the discovery URLs', () => {
    const next = vi.fn() as unknown as NextFunction;
    const req = mockReq('POST', '/api/v1/news/summary');
    const res = mockRes();
    methodNotAllowedHandler(req, res, next);
    const body = res._json as { docs: { openapi: string; x402_registry: string } };
    expect(body.docs.openapi).toBe('/openapi.json');
    expect(body.docs.x402_registry).toBe('/.well-known/x402');
  });
});
