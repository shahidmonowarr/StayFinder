import type { SearchQuery, SupplierMeta } from "@stayfinder/shared";
import type { SupplierAdapter, SupplierRequestContext } from "../adapters/types";
import { cacheKeyFor, isCacheable, type CachedSearch, type SearchCache } from "../cache";
import { fanOut, type LegOutcome } from "../orchestrator/fanout";

/**
 * The cache-aware search, shared by the buffered route and the SSE route.
 *
 * Both need identical behaviour around lookup, the all-suppliers-ok gate, and
 * storing — so it lives here once rather than being duplicated with a subtle
 * difference that shows up as a bug six months later.
 */

export interface SearchServiceOptions {
  adapters: readonly SupplierAdapter[];
  cache: SearchCache;
  timeoutMs?: number;
}

export interface SearchOutcome {
  result: CachedSearch;
  cached: boolean;
  elapsedMs: number;
}

export interface RunSearchOptions {
  /**
   * Fired the moment the cache lookup resolves, before any fan-out starts.
   * The SSE route needs this because its `meta` event must state truthfully
   * whether the response is cached, and `meta` goes out first.
   */
  onCacheResult?: (cached: boolean) => void;
  /** Fired per leg as it settles. Never fired on a cache hit — nothing streams. */
  onLeg?: (leg: LegOutcome) => void;
  /** Cancels in-flight legs when the client disconnects. */
  signal?: AbortSignal;
  /** Per-request supplier instructions, e.g. forced chaos. */
  context?: SupplierRequestContext;
}

export async function runSearch(
  service: SearchServiceOptions,
  query: SearchQuery,
  options: RunSearchOptions = {},
): Promise<SearchOutcome> {
  const startedAt = performance.now();
  const key = cacheKeyFor(query);

  // Chaos runs bypass the cache in both directions. A forced failure is not a
  // result worth serving to the next visitor, and reading a cached clean result
  // would make "break SupplierGamma" appear to do nothing.
  const chaotic = options.context?.chaos !== undefined;

  const hit = chaotic ? undefined : await service.cache.get(key);
  options.onCacheResult?.(hit !== undefined);

  if (hit !== undefined) {
    return { result: hit, cached: true, elapsedMs: Math.round(performance.now() - startedAt) };
  }

  const result = await fanOut(service.adapters, query, {
    ...(service.timeoutMs === undefined ? {} : { timeoutMs: service.timeoutMs }),
    ...(options.onLeg === undefined ? {} : { onLeg: options.onLeg }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.context === undefined ? {} : { context: options.context }),
  });

  if (!chaotic && isCacheable(result.suppliers)) {
    await service.cache.set(key, { options: result.options, suppliers: result.suppliers });
  }

  return {
    result: { options: result.options, suppliers: result.suppliers },
    cached: false,
    elapsedMs: Math.round(performance.now() - startedAt),
  };
}

/** Split a cached result back into per-supplier legs, so a hit can be replayed. */
export function legsFromCache(cached: CachedSearch): LegOutcome[] {
  return cached.suppliers.map((meta: SupplierMeta) => ({
    meta,
    options: cached.options.filter((option) => option.supplier === meta.supplier),
  }));
}
