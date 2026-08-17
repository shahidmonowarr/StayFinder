import type { HotelOption, Money, SearchQuery, SupplierId } from "@stayfinder/shared";

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
  /**
   * Ask the supplier what one property costs right now.
   *
   * Unlike `search`, this has no useful degraded answer: "what will this
   * actually cost" cannot be approximated, so a failure here propagates rather
   * than being absorbed into a status field.
   */
  quote(request: QuoteRequest, signal: AbortSignal): Promise<SupplierQuote>;
}

export interface QuoteRequest {
  supplierHotelId: string;
  checkIn: string;
  checkOut: string;
  guests: number;
}

/**
 * A live price, normalized. Carries the property as well as the money, because
 * the booking record is built from this and must not depend on anything the
 * client sent back.
 */
export interface SupplierQuote {
  supplier: SupplierId;
  supplierHotelId: string;
  hotelName: string;
  city: string;
  starRating: number;
  nightlyRate: Money;
  totalPrice: Money;
  nights: number;
  refundable: boolean;
}

/** The supplier does not have the property we asked about. */
export class SupplierHotelNotFoundError extends Error {
  constructor(supplier: SupplierId, supplierHotelId: string) {
    super(`Supplier ${supplier} has no hotel ${supplierHotelId}`);
    this.name = "SupplierHotelNotFoundError";
  }
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
