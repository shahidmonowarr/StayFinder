import type { HotelOption, SearchQuery, SupplierMeta } from "@stayfinder/shared";

/** Search results TTL. Short enough that a stale rate cannot survive long. */
export const SEARCH_CACHE_TTL_SECONDS = 60;

/**
 * What gets stored. Not the whole `SearchResponse`: `query` is recoverable from
 * the key and `cached` is a property of *this* response rather than of the
 * stored value, so storing either would be storing a lie waiting to be read.
 */
export interface CachedSearch {
  options: HotelOption[];
  suppliers: SupplierMeta[];
}

export interface SearchCache {
  /** For the health endpoint, so a demo can show which backend is live. */
  readonly kind: "redis" | "memory";
  get(key: string): Promise<CachedSearch | undefined>;
  set(key: string, value: CachedSearch): Promise<void>;
  close(): Promise<void>;
}

/**
 * Cache key. Versioned on purpose: `HotelOption` changes in later milestones,
 * and a running Redis would happily serve entries of the old shape into new
 * code. Bumping `v1` retires them instead.
 *
 * The destination is normalized so "Lisbon" and " lisbon " share one entry —
 * two spellings of one search should not cost two fan-outs.
 */
export function cacheKeyFor(query: SearchQuery): string {
  const destination = query.destination.trim().toLowerCase();
  return `search:v1:${destination}:${query.checkIn}:${query.checkOut}:${query.guests}`;
}

/**
 * Only a complete result set is worth caching.
 *
 * Storing a response where Gamma 500ed would hand that degraded result to every
 * visitor for the next 60 seconds. A re-run costs one fan-out and might get the
 * full set; sticky partial failure costs a minute of wrong prices.
 */
export function isCacheable(suppliers: readonly SupplierMeta[]): boolean {
  return suppliers.length > 0 && suppliers.every((supplier) => supplier.status === "ok");
}
