import { fromMinor, type LedgerEntry } from "@stayfinder/shared";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LedgerTable } from "./ledger-table";

function entry(kind: LedgerEntry["kind"], amountMinor: number, id = `${kind}-${amountMinor}`) {
  return {
    id,
    kind,
    amount: fromMinor(amountMinor, "EUR"),
    providerRef: `ref_${id}`,
    createdAt: "2026-08-17T10:00:00.000Z",
  } satisfies LedgerEntry;
}

describe("LedgerTable", () => {
  it("says plainly when no money has moved", () => {
    render(<LedgerTable entries={[]} currency="EUR" />);

    expect(screen.getByText(/No money has moved yet/)).toBeDefined();
  });

  it("lists a charge with its provider reference", () => {
    render(<LedgerTable entries={[entry("CHARGE", 38970)]} currency="EUR" />);

    expect(screen.getByText("CHARGE")).toBeDefined();
    expect(screen.getByText("ref_CHARGE-38970")).toBeDefined();
    // Twice: once as the entry, once as the derived balance. With a single
    // charge and no refunds those are necessarily the same figure.
    expect(screen.getAllByText("€389.70")).toHaveLength(2);
  });

  it("shows a refund as a second row rather than changing the charge", () => {
    // The whole point of an append-only ledger: the charge is still 389.70.
    render(
      <LedgerTable entries={[entry("CHARGE", 38970), entry("REFUND", 38970)]} currency="EUR" />,
    );

    const rows = screen.getAllByRole("row");
    // header + 2 entries + footer
    expect(rows).toHaveLength(4);
    expect(screen.getByText("CHARGE")).toBeDefined();
    expect(screen.getByText("REFUND")).toBeDefined();
  });

  it("derives the balance from the rows", () => {
    render(
      <LedgerTable entries={[entry("CHARGE", 38970), entry("REFUND", 38970)]} currency="EUR" />,
    );

    expect(screen.getByText(/summed from the rows above/)).toBeDefined();
    expect(screen.getByText("€0.00")).toBeDefined();
  });

  it("shows a partial refund's remaining balance", () => {
    render(
      <LedgerTable entries={[entry("CHARGE", 38970), entry("REFUND", 10000)]} currency="EUR" />,
    );

    expect(screen.getByText("€289.70")).toBeDefined();
  });

  it("explains that the table is append-only at the database level", () => {
    render(<LedgerTable entries={[entry("CHARGE", 38970)]} currency="EUR" />);

    expect(screen.getByText(/Append-only, enforced by a Postgres trigger/)).toBeDefined();
  });
});
