import { fromMinor, netAmountMinor, type LedgerEntry } from "@stayfinder/shared";
import type { Transaction } from "../generated/prisma/client";
import type { PrismaClient } from "./client";

/**
 * The money ledger.
 *
 * There is no `update` and no `delete` on this repository, and there is no way
 * to add one that would work: the migration installs a Postgres trigger that
 * raises on both. The API surface and the database agree.
 */
export class LedgerRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async forBooking(bookingId: string): Promise<LedgerEntry[]> {
    const rows = await this.prisma.transaction.findMany({
      where: { bookingId },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(toLedgerEntry);
  }

  /**
   * What the booking is currently worth to us, computed from the rows rather
   * than stored anywhere. A stored balance is a second source of truth that
   * drifts the first time a write half-fails.
   */
  async balanceMinor(bookingId: string): Promise<number> {
    return netAmountMinor(await this.forBooking(bookingId));
  }
}

export function toLedgerEntry(row: Transaction): LedgerEntry {
  return {
    id: row.id,
    kind: row.kind,
    amount: fromMinor(row.amountMinor, row.currency),
    providerRef: row.providerRef,
    createdAt: row.createdAt.toISOString(),
  };
}
