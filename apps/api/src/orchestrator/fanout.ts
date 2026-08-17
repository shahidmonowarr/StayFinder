import {
  compareByPrice,
  type HotelOption,
  type SearchQuery,
  type SupplierMeta,
} from "@stayfinder/shared";
import type { SupplierAdapter } from "../adapters/types";

/**
 * Parallel supplier fan-out with per-supplier deadlines and total failure
 * isolation.
 *
 * The invariant: **one supplier's problem is never the user's problem.** A leg
 * that times out, 500s, or returns garbage contributes a `SupplierMeta` saying
 * so and zero options. It cannot reject the search, and it cannot delay the
 * other legs.
 *
 * This module deliberately knows nothing about HTTP, hotels, or which suppliers
 * exist — it takes adapters as an argument. That is what makes the interesting
 * behaviour (deadlines, isolation, classification) testable without a network.
 */

/** Hard per-supplier deadline. Beta's latency ceiling of 2000ms sits above it. */
export const DEFAULT_TIMEOUT_MS = 1500;

export interface FanOutOptions {
  timeoutMs?: number;
  /** Injectable clock so latency assertions do not depend on real time. */
  now?: () => number;
}

export interface FanOutResult {
  options: HotelOption[];
  suppliers: SupplierMeta[];
}

interface LegOutcome {
  meta: SupplierMeta;
  options: HotelOption[];
}

/**
 * Pull a usable detail out of an error's `cause`.
 *
 * Two shapes have to be handled, both of them Node's doing:
 *
 * - A plain `Error` cause, which happens when the host is a literal IP.
 * - An `AggregateError` **with an empty message**, which happens when the host
 *   is `localhost`: it resolves to both `::1` and `127.0.0.1`, undici attempts
 *   both, and collects the two failures. Reading `.message` on that gives ""
 *   and silently loses the reason — which is exactly the bug this function was
 *   written to fix, so the aggregate case is not a hypothetical.
 */
function causeDetail(cause: unknown): string | undefined {
  if (!(cause instanceof Error)) return undefined;
  if (cause.message !== "") return cause.message;
  if (cause instanceof AggregateError) {
    return cause.errors.find(
      (inner: unknown): inner is Error => inner instanceof Error && inner.message !== "",
    )?.message;
  }
  return undefined;
}

/**
 * Node's `fetch` reports every transport failure as the same useless
 * `TypeError: fetch failed` and hides what actually happened underneath. An
 * operator reading the status strip needs "connect ECONNREFUSED 127.0.0.1:4001",
 * not "fetch failed" — the first names the problem, the second just confirms
 * there is one.
 */
function describe(error: Error): string {
  const detail = causeDetail((error as { cause?: unknown }).cause);
  return detail === undefined ? error.message : `${error.message}: ${detail}`;
}

/**
 * Decide what a thrown value means for the status strip.
 *
 * `timeout` and `error` are kept apart because they tell an operator different
 * things: a timeout is a supplier that may be perfectly healthy but slow today,
 * an error is one that answered wrongly. Conflating them would make the strip
 * useless for diagnosis.
 */
function classify(error: unknown): { status: "timeout" | "error"; message: string } {
  if (error instanceof Error) {
    // `AbortSignal.timeout()` rejects with a DOMException named TimeoutError;
    // AbortError arrives if something else cancelled us first.
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      return { status: "timeout", message: "Supplier exceeded the response deadline" };
    }
    return { status: "error", message: describe(error) };
  }
  return { status: "error", message: "Supplier failed for an unknown reason" };
}

async function runLeg(
  adapter: SupplierAdapter,
  query: SearchQuery,
  timeoutMs: number,
  now: () => number,
): Promise<LegOutcome> {
  const startedAt = now();
  // A fresh signal per leg: one supplier's deadline must not cancel another's.
  const signal = AbortSignal.timeout(timeoutMs);

  try {
    const result = await adapter.search(query, signal);
    return {
      options: result.options,
      meta: {
        supplier: adapter.id,
        status: "ok",
        latencyMs: Math.round(now() - startedAt),
        resultCount: result.options.length,
        droppedCount: result.dropped,
      },
    };
  } catch (error) {
    const { status, message } = classify(error);
    return {
      options: [],
      meta: {
        supplier: adapter.id,
        status,
        // Latency is still reported on a failed leg — "timed out after 1502ms"
        // and "500ed after 40ms" are different stories about a supplier.
        latencyMs: Math.round(now() - startedAt),
        resultCount: 0,
        droppedCount: 0,
        message,
      },
    };
  }
}

export async function fanOut(
  adapters: readonly SupplierAdapter[],
  query: SearchQuery,
  options: FanOutOptions = {},
): Promise<FanOutResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const now = options.now ?? (() => performance.now());

  // All legs are dispatched before any is awaited, so the deadlines run
  // concurrently: worst-case wall clock is one timeout, not the sum of three.
  //
  // `runLeg` is written never to reject. `allSettled` is the belt to that
  // braces: if it ever does — a bug in classification, say — the result is one
  // degraded supplier rather than a 500 for the whole search.
  const settled = await Promise.allSettled(
    adapters.map((adapter) => runLeg(adapter, query, timeoutMs, now)),
  );

  const suppliers: SupplierMeta[] = [];
  const collected: HotelOption[] = [];

  settled.forEach((outcome, index) => {
    if (outcome.status === "fulfilled") {
      suppliers.push(outcome.value.meta);
      collected.push(...outcome.value.options);
      return;
    }

    const adapter = adapters[index];
    const { status, message } = classify(outcome.reason);
    suppliers.push({
      supplier: adapter!.id,
      status,
      latencyMs: 0,
      resultCount: 0,
      droppedCount: 0,
      message,
    });
  });

  // Sorted here rather than in the route so the ordering is part of the
  // orchestrator's tested behaviour, not an incidental property of the handler.
  return { options: collected.sort(compareByPrice), suppliers };
}
