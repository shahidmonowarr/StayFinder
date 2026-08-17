import type { HotelOption, SearchQuery, SupplierId } from "@stayfinder/shared";

/**
 * The boundary that keeps supplier weirdness out of the rest of the system.
 *
 * An adapter owns everything specific to one supplier: the URL, the parameter
 * names, the protocol, the payload shape, and the price normalization. What it
 * returns is already `HotelOption` — the orchestrator downstream knows how to
 * run N things in parallel under a deadline and nothing else.
 *
 * The test of whether this boundary is in the right place: adding a fourth
 * supplier should require a new file here and one line in the registry, and no
 * change to the orchestrator at all.
 */
export interface SupplierAdapter {
  readonly id: SupplierId;
  /**
   * @param signal Aborts when the per-supplier deadline expires. Implementations
   * must pass it to `fetch` rather than merely checking it, so an abandoned
   * request is actually cancelled instead of left streaming into nothing.
   */
  search(query: SearchQuery, signal: AbortSignal): Promise<AdapterResult>;
}

export interface AdapterResult {
  options: HotelOption[];
  /**
   * Rows the supplier returned that this adapter could not normalize. Reported
   * rather than swallowed: a supplier silently shedding inventory is a bug.
   */
  dropped: number;
}

/** The supplier answered, but not with success. */
export class SupplierResponseError extends Error {
  constructor(supplier: SupplierId, status: number) {
    super(`Supplier ${supplier} responded with HTTP ${status}`);
    this.name = "SupplierResponseError";
  }
}

/** The supplier answered with something this adapter cannot read at all. */
export class SupplierPayloadError extends Error {
  constructor(supplier: SupplierId, detail: string) {
    super(`Supplier ${supplier} returned an unreadable payload: ${detail}`);
    this.name = "SupplierPayloadError";
  }
}
