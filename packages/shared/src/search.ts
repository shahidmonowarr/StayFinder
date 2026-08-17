import type { HotelOption, SupplierMeta } from "./hotel-option";

const MS_PER_DAY = 86_400_000;

/**
 * Nights in a stay. `checkOut` is exclusive — the checkout day is not a night —
 * so a 01→04 stay is three nights.
 *
 * Dates are parsed at UTC midnight rather than local time. A local-time parse
 * would make the night count depend on the server's timezone and on daylight
 * saving, which is how off-by-one-night pricing bugs happen.
 */
export function nightsBetween(checkIn: string, checkOut: string): number {
  const from = Date.parse(`${checkIn}T00:00:00Z`);
  const to = Date.parse(`${checkOut}T00:00:00Z`);
  return Math.round((to - from) / MS_PER_DAY);
}

/** The user's request. Cache keys are derived from exactly these fields. */
export interface SearchQuery {
  destination: string;
  /** ISO calendar date, YYYY-MM-DD. */
  checkIn: string;
  /** ISO calendar date, YYYY-MM-DD. Exclusive — checkout day is not a night. */
  checkOut: string;
  guests: number;
}

/**
 * The complete `/api/search` payload.
 *
 * `suppliers` is part of the contract rather than a debug extra: a response is
 * still valid — and still rendered — when a supplier timed out, and the UI has
 * to be able to say so honestly instead of implying the results are complete.
 */
export interface SearchResponse {
  query: SearchQuery;
  options: HotelOption[];
  suppliers: SupplierMeta[];
  /** True when served from the 60s search cache rather than a live fan-out. */
  cached: boolean;
}
