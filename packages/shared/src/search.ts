import type { HotelOption, SupplierMeta } from "./hotel-option";

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
