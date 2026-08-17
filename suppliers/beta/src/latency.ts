import type { RequestHandler } from "express";

/** Simulated network latency, injectable so tests do not wait it out. */
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

export const MIN_LATENCY_MS = 800;
export const MAX_LATENCY_MS = 2000;

/**
 * Beta is slow, and its ceiling sits deliberately above the aggregator's
 * 1500ms deadline: roughly a quarter of searches time out on Beta's leg
 * naturally, so the isolation path is exercised in ordinary use rather than
 * only under a staged test.
 */
export function defaultDelayMs(): number {
  if (process.env.NODE_ENV === "test") return 0;
  return MIN_LATENCY_MS + Math.random() * (MAX_LATENCY_MS - MIN_LATENCY_MS);
}
