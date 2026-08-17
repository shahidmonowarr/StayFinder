import type { RequestHandler } from "express";

/**
 * Simulated network latency, injected as a function so tests can set it to
 * zero rather than waiting it out. Every supplier does this the same way; the
 * numbers differ, the mechanism does not.
 */
export function delayMiddleware(delayMs: () => number): RequestHandler {
  return (_req, _res, next) => {
    const ms = delayMs();
    if (ms <= 0) {
      next();
      return;
    }
    setTimeout(next, ms);
  };
}

/** Alpha is the fast, reliable control case: a flat ~100ms. */
export function defaultDelayMs(): number {
  return process.env.NODE_ENV === "test" ? 0 : 100;
}
