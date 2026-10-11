import { describe, it, expect } from 'vitest';
import { serializeError } from '../src/utils/serialize-error';

describe('serializeError', () => {
  it('flattens an Error so Winston logs the message instead of {}', () => {
    const err = new Error('facilitator rejected signature');
    const out = serializeError(err);
    expect(out.error).toBe('facilitator rejected signature');
    expect(out.stack).toContain('Error: facilitator rejected signature');
  });

  it('falls back to class name when the Error has no message', () => {
    class CustomError extends Error { constructor() { super(''); this.name = 'CustomError'; } }
    const out = serializeError(new CustomError());
    expect(out.error).toBe('CustomError');
  });

  it('stringifies non-Error throws', () => {
    expect(serializeError('something bad')).toEqual({ error: 'something bad' });
    expect(serializeError(42)).toEqual({ error: '42' });
    expect(serializeError(null)).toEqual({ error: 'null' });
    expect(serializeError({ foo: 'bar' })).toEqual({ error: '[object Object]' });
  });

  it('spread into a log context yields enumerable keys (fixes the Winston {err:{}} bug)', () => {
    const ctx = { filename: 'pem.ts', ...serializeError(new Error('rate limited')) };
    expect(Object.keys(ctx)).toEqual(['filename', 'error', 'stack']);
    expect(ctx.error).toBe('rate limited');
  });
});
