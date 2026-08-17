import { fromMinor, type Money } from "./money";

/**
 * The money ledger.
 *
 * Two kinds of entry and no third: money came in, or money went back. A refund
 * is a new `REFUND` row, never an edit to the `CHARGE` it reverses — payment
 * state that can be overwritten cannot be audited, and duplicate webhook
 * deliveries become dangerous the moment handling one means mutating a balance.
 *
 * Appending makes replay safe by construction, and it means a booking's
 * financial history can be reconstructed from these rows alone.
 */
export type TransactionKind = "CHARGE" | "REFUND";

export interface LedgerEntry {
  id: string;
  kind: TransactionKind;
  amount: Money;
  /** The payment provider's own identifier, so a row can be traced upstream. */
  providerRef: string;
  createdAt: string;
}

/**
 * What the booking is currently worth to us, derived rather than stored.
 *
 * A stored balance is a second source of truth that drifts the first time a
 * write half-fails. Summing is cheap at this scale and cannot disagree with the
 * rows it was computed from.
 */
export function netAmountMinor(entries: readonly LedgerEntry[]): number {
  return entries.reduce(
    (total, entry) => total + (entry.kind === "CHARGE" ? 1 : -1) * entry.amount.amountMinor,
    0,
  );
}

/** The same figure as `Money`. Throws if entries disagree about currency. */
export function netAmount(entries: readonly LedgerEntry[], currency: string): Money {
  for (const entry of entries) {
    if (entry.amount.currency !== currency) {
      throw new Error(`Ledger mixes ${currency} and ${entry.amount.currency}`);
    }
  }
  return fromMinor(netAmountMinor(entries), currency);
}

/** True once every charge has been returned. */
export function isFullyRefunded(entries: readonly LedgerEntry[]): boolean {
  return entries.length > 0 && netAmountMinor(entries) === 0;
}
