/**
 * The booking state machine.
 *
 * A pure module: no database, no Stripe client, no clock, no I/O of any kind.
 * That is the whole point — the rules about what may happen to a booking are the
 * part of this system where a mistake costs real money, so they are written
 * somewhere they can be tested exhaustively and read in one sitting.
 *
 * Everything that needs a side effect — persisting, charging, refunding — lives
 * a layer up and asks this module whether it is allowed to proceed.
 */

export type BookingStatus = "PENDING" | "CONFIRMED" | "CANCELLED" | "REFUNDED" | "FAILED";

/**
 * What can be *done* to a booking, as distinct from the state it lands in.
 * Naming the action rather than the destination is what makes an illegal
 * request expressible: `refund` on a PENDING booking is a sentence the type
 * system permits and this module rejects.
 */
export type BookingTransition = "confirm" | "fail" | "cancel" | "refund";

export const BOOKING_STATUSES: readonly BookingStatus[] = [
  "PENDING",
  "CONFIRMED",
  "CANCELLED",
  "REFUNDED",
  "FAILED",
] as const;

export const BOOKING_TRANSITIONS: readonly BookingTransition[] = [
  "confirm",
  "fail",
  "cancel",
  "refund",
] as const;

/**
 * The complete map. Anything absent is illegal — there is no fallback branch,
 * so a new status cannot quietly inherit permissive behaviour.
 *
 *   PENDING ──confirm──→ CONFIRMED ──cancel──→ CANCELLED ──refund──→ REFUNDED
 *      │                                          ▲
 *      ├──fail──→ FAILED                          │
 *      └──cancel───────────────────────────────────┘
 *
 * Two deliberate omissions:
 *
 * - **No CONFIRMED → REFUNDED.** Money can only be returned for a booking that
 *   has been cancelled. Refunding a live booking would leave the guest holding
 *   both their money and their room, and the supplier still owing a night.
 * - **No FAILED → anything.** A failed payment does not become a booking later;
 *   the client retries and gets a new one. Reviving it would mean a booking that
 *   was never paid for silently turning into one that was.
 */
const TRANSITIONS: Readonly<
  Record<BookingStatus, Readonly<Partial<Record<BookingTransition, BookingStatus>>>>
> = {
  PENDING: { confirm: "CONFIRMED", fail: "FAILED", cancel: "CANCELLED" },
  CONFIRMED: { cancel: "CANCELLED" },
  CANCELLED: { refund: "REFUNDED" },
  REFUNDED: {},
  FAILED: {},
};

/** The initial state of every booking. Nothing transitions *into* it. */
export const INITIAL_STATUS: BookingStatus = "PENDING";

export class IllegalTransitionError extends Error {
  readonly from: BookingStatus;
  readonly transition: BookingTransition;

  constructor(from: BookingStatus, transition: BookingTransition) {
    super(`Cannot ${transition} a booking in state ${from}`);
    this.name = "IllegalTransitionError";
    this.from = from;
    this.transition = transition;
  }
}

/** A state from which nothing further can happen. */
export function isTerminal(status: BookingStatus): boolean {
  return legalTransitions(status).length === 0;
}

/** Every action permitted from a given state. Empty for terminal states. */
export function legalTransitions(status: BookingStatus): BookingTransition[] {
  return BOOKING_TRANSITIONS.filter((transition) => TRANSITIONS[status][transition] !== undefined);
}

/**
 * Whether a transition is allowed, without throwing.
 *
 * This exists so callers can be idempotent *deliberately* rather than by
 * swallowing exceptions. M6's duplicate Stripe webhooks are the motivating
 * case: the second delivery of `payment_succeeded` should be a considered
 * no-op after checking the booking is already CONFIRMED — not a caught error,
 * because catching would make a genuine double-charge look identical to a
 * harmless retry.
 */
export function canTransition(from: BookingStatus, transition: BookingTransition): boolean {
  return TRANSITIONS[from][transition] !== undefined;
}

/**
 * Apply a transition, or throw.
 *
 * Strict on purpose: it does *not* treat "already in the target state" as
 * success. `confirm` on a CONFIRMED booking is a bug somewhere — a lost update,
 * a replayed request nobody guarded — and this is the layer most likely to
 * notice. Silently absorbing it would erase the only signal.
 */
export function applyTransition(from: BookingStatus, transition: BookingTransition): BookingStatus {
  const next = TRANSITIONS[from][transition];
  if (next === undefined) {
    throw new IllegalTransitionError(from, transition);
  }
  return next;
}

/**
 * Whether a booking's money has been taken and not yet returned. Used by the
 * UI to decide whether to offer cancellation, and by M6 to decide whether a
 * cancellation needs a refund at all.
 */
export function isPaid(status: BookingStatus): boolean {
  return status === "CONFIRMED" || status === "CANCELLED";
}
