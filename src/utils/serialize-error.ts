/**
 * Winston silently drops `message`/`stack` when you log an Error via the
 * `{ err }` pattern — Error's own-enumerable properties are empty, so the
 * output is `err: {}`. In production that cost us the actual Anthropic
 * failure context when a /review/code call 502'd (see Railway logs around
 * 2026-10-10T21:46).
 *
 * This helper flattens an unknown error into { error, stack } primitives
 * Winston will serialise cleanly. Spread the result into the log context:
 *
 *   logger.error('Code review failed', { filename, ...serializeError(err) });
 */
export function serializeError(err: unknown): { error: string; stack?: string } {
  if (err instanceof Error) {
    return { error: err.message || err.name || 'unknown error', stack: err.stack };
  }
  return { error: String(err) };
}
