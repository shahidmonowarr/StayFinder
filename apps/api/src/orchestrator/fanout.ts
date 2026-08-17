import {
  compareByPrice,
  type HotelOption,
  type SearchQuery,
  type SupplierMeta,
} from "@stayfinder/shared";
import type { SupplierAdapter, SupplierRequestContext } from "../adapters/types";
import { describeError } from "../errors";

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
  /**
   * Called the moment a leg settles, before the fan-out as a whole finishes.
   * This is the hook the SSE route uses to push a supplier's results the
   * instant they exist; the buffered route simply omits it.
   *
   * Fires in *completion* order — Alpha at ~100ms, Beta a second later — which
   * is the whole point. The final `suppliers` array stays in adapter order so
   * the buffered response remains stable.
   */
  onLeg?: (leg: LegOutcome) => void;
  /**
   * Cancels every in-flight leg. Used when the SSE client disconnects: there is
   * nobody left to send results to, so continuing to hold supplier connections
   * open is pure waste.
   */
  signal?: AbortSignal;
  /** Per-request instructions passed to each adapter. Only Gamma acts on it. */
  context?: SupplierRequestContext;
}

export interface FanOutResult {
  options: HotelOption[];
  suppliers: SupplierMeta[];
}

export interface LegOutcome {
  meta: SupplierMeta;
  options: HotelOption[];
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
    return { status: "error", message: describeError(error) };
  }
  return { status: "error", message: "Supplier failed for an unknown reason" };
}

interface LegContext {
  query: SearchQuery;
  timeoutMs: number;
  now: () => number;
  /** The caller's cancellation, if any — combined with, not replacing, the deadline. */
  external: AbortSignal | undefined;
  onLeg: ((leg: LegOutcome) => void) | undefined;
  supplierContext: SupplierRequestContext | undefined;
}

async function runLeg(adapter: SupplierAdapter, context: LegContext): Promise<LegOutcome> {
  const { timeoutMs, now, external } = context;
  const startedAt = now();
  // A fresh signal per leg: one supplier's deadline must not cancel another's.
  // When the caller supplies its own signal, the leg answers to whichever fires
  // first — its deadline, or the client hanging up.
  const deadline = AbortSignal.timeout(timeoutMs);
  const signal = external ? AbortSignal.any([deadline, external]) : deadline;

  const outcome = await settle(adapter, signal, startedAt, context);
  // Notified here rather than by the caller after `allSettled`, because the
  // whole value of this callback is that it fires before the slow legs finish.
  context.onLeg?.(outcome);
  return outcome;
}

async function settle(
  adapter: SupplierAdapter,
  signal: AbortSignal,
  startedAt: number,
  { query, now, supplierContext }: LegContext,
): Promise<LegOutcome> {
  try {
    const result = await adapter.search(query, signal, supplierContext);
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
  const context: LegContext = {
    query,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    now: options.now ?? (() => performance.now()),
    external: options.signal,
    onLeg: options.onLeg,
    supplierContext: options.context,
  };

  // All legs are dispatched before any is awaited, so the deadlines run
  // concurrently: worst-case wall clock is one timeout, not the sum of three.
  //
  // `runLeg` is written never to reject. `allSettled` is the belt to that
  // braces: if it ever does — a bug in classification, say — the result is one
  // degraded supplier rather than a 500 for the whole search.
  const settled = await Promise.allSettled(adapters.map((adapter) => runLeg(adapter, context)));

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
