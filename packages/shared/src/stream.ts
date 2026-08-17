import type { HotelOption, SupplierId, SupplierMeta } from "./hotel-option";
import type { SearchQuery } from "./search";

/**
 * The `/api/search/stream` protocol, defined once and shared by the server that
 * emits it and the client that consumes it.
 *
 * Three event types, in this order:
 *
 * ```
 * event: meta   — the query, which suppliers to expect, whether this is cached
 * event: leg    — one per supplier, as it settles, in completion order
 * event: done   — the stream is finished; the client must close the connection
 * ```
 *
 * A `leg` event carries a supplier's status *and* its options together. The
 * alternative — separate status and result events — would force the client to
 * correlate them, for no benefit: a leg either produced options or it did not,
 * and either way that is one fact arriving at one moment.
 */

export const STREAM_EVENT = {
  meta: "meta",
  leg: "leg",
  done: "done",
} as const;

export interface StreamMetaEvent {
  query: SearchQuery;
  /**
   * Every supplier the aggregator is about to ask. Sent up front so the UI can
   * render the full status strip as pending immediately, rather than growing it
   * one chip at a time as answers arrive.
   */
  suppliers: SupplierId[];
  cached: boolean;
}

export interface StreamLegEvent {
  meta: SupplierMeta;
  options: HotelOption[];
}

export interface StreamDoneEvent {
  elapsedMs: number;
}
