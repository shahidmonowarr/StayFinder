import { describe, expect, it } from "vitest";
import { isFullyRefunded, netAmount, netAmountMinor, type LedgerEntry } from "./ledger";
import { fromMinor } from "./money";

function entry(kind: LedgerEntry["kind"], amountMinor: number, currency = "EUR"): LedgerEntry {
  return {
    id: `${kind}-${amountMinor}`,
    kind,
    amount: fromMinor(amountMinor, currency),
    providerRef: "ref",
    createdAt: "2026-08-17T10:00:00.000Z",
  };
}

describe("netAmountMinor", () => {
  it("is zero for a booking with no movements", () => {
    expect(netAmountMinor([])).toBe(0);
  });

  it("sums charges", () => {
    expect(netAmountMinor([entry("CHARGE", 38970)])).toBe(38970);
  });

  it("subtracts refunds rather than editing the charge", () => {
    // The refund is a second row. The charge is still 38970 and always will be.
    const entries = [entry("CHARGE", 38970), entry("REFUND", 38970)];

    expect(netAmountMinor(entries)).toBe(0);
    expect(entries[0]?.amount.amountMinor).toBe(38970);
  });

  it("handles a partial refund", () => {
    expect(netAmountMinor([entry("CHARGE", 38970), entry("REFUND", 10000)])).toBe(28970);
  });

  it("handles several movements in sequence", () => {
    expect(
      netAmountMinor([
        entry("CHARGE", 38970),
        entry("REFUND", 10000),
        entry("REFUND", 10000),
        entry("CHARGE", 5000),
      ]),
    ).toBe(23970);
  });
});

describe("netAmount", () => {
  it("returns the balance as Money", () => {
    expect(netAmount([entry("CHARGE", 38970)], "EUR")).toEqual({
      amountMinor: 38970,
      currency: "EUR",
    });
  });

  it("refuses to add up entries in different currencies", () => {
    // Silently summing across currencies would produce a number that looks like
    // money and means nothing.
    expect(() => netAmount([entry("CHARGE", 100), entry("REFUND", 100, "USD")], "EUR")).toThrow(
      /mixes EUR and USD/,
    );
  });
});

describe("isFullyRefunded", () => {
  it("is true once everything charged has been returned", () => {
    expect(isFullyRefunded([entry("CHARGE", 38970), entry("REFUND", 38970)])).toBe(true);
  });

  it("is false for a partial refund", () => {
    expect(isFullyRefunded([entry("CHARGE", 38970), entry("REFUND", 10000)])).toBe(false);
  });

  it("is false for a booking that was never charged", () => {
    // A zero balance because nothing happened is not the same as a refund.
    expect(isFullyRefunded([])).toBe(false);
  });
});
