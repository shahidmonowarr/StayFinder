import type { Request } from "express";
import { parseChaosMode, type SupplierRequestContext } from "../adapters/types";

/**
 * Read the chaos setting off a request.
 *
 * A **query parameter**, not a header, and the reason is a constraint rather
 * than a preference: the search stream is consumed with `EventSource`, which
 * cannot set custom headers at all. Having chaos arrive one way on the stream
 * and another way everywhere else would be worse than picking the one that
 * works everywhere.
 *
 * The `x-chaos` header is still accepted, so the same forcing works from `curl`
 * against the suppliers directly and against the aggregator.
 *
 * Chaos is per-request. A server-side flag would be shared mutable state: two
 * visitors would fight over it, and one person's setting would outlive them.
 */
export function chaosContextFrom(req: Request): SupplierRequestContext | undefined {
  const chaos =
    parseChaosMode(req.query.chaos) ?? parseChaosMode(req.header("x-chaos")) ?? undefined;

  return chaos === undefined ? undefined : { chaos };
}
