import type { Money } from "./money";

/** The three mock suppliers. Fixed set — real supplier onboarding is out of scope. */
export type SupplierId = "alpha" | "beta" | "gamma";

export const SUPPLIER_IDS: readonly SupplierId[] = ["alpha", "beta", "gamma"] as const;

/**
 * Outcome of a single supplier's leg of a fan-out.
 *
 * `timeout` and `error` are kept distinct because they mean different things to
 * an operator: a timeout is a slow supplier that may still be healthy, an error
 * is a supplier that answered wrongly. The UI's supplier-status strip renders
 * them differently for exactly that reason.
 */
export type SupplierStatus = "ok" | "timeout" | "error";

export interface SupplierMeta {
  supplier: SupplierId;
  status: SupplierStatus;
  /** Wall-clock time until the supplier resolved, or until the timeout fired. */
  latencyMs: number;
  /** Options contributed after normalization. Zero for timeout/error. */
  resultCount: number;
  /**
   * Rows the supplier returned that could not be normalized and were skipped.
   * Non-zero with `status: "ok"` means the supplier partly answered — visible
   * rather than silent, because a supplier quietly shedding half its inventory
   * is a bug worth noticing.
   */
  droppedCount: number;
  /** Operator-facing reason, present only when status is not "ok". */
  message?: string;
}

/**
 * The one shape the rest of the system knows about.
 *
 * Every supplier response — Alpha's camelCase cents, Beta's snake_case decimal
 * strings, Gamma's nested GraphQL payload — is normalized into this before it
 * leaves the supplier adapter. Nothing downstream of the adapters should ever
 * branch on `supplier` to interpret a price.
 */
export interface HotelOption {
  /** `${supplier}:${supplierHotelId}` — unique across the merged result set. */
  id: string;
  supplier: SupplierId;
  /** The supplier's own identifier, needed to re-quote against them later. */
  supplierHotelId: string;

  name: string;
  city: string;
  /** 1–5. Suppliers that omit it are normalized to 0, meaning "unrated". */
  starRating: number;

  /** Always populated, even for suppliers that only quote stay totals. */
  nightlyRate: Money;
  /** Always populated, even for suppliers that only quote nightly rates. */
  totalPrice: Money;

  checkIn: string;
  checkOut: string;
  nights: number;
  guests: number;
  refundable: boolean;

  /**
   * Identity of the *physical* hotel, independent of who is selling it.
   * Two options sharing a dedupeKey are the same property from different
   * suppliers and get merged into one card showing the cheapest rate.
   */
  dedupeKey: string;
}
