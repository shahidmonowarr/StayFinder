import { BOOKING_STATUSES, type BookingStatus } from "@stayfinder/shared";
import { describe, expect, it } from "vitest";
import { BookingStatus as PrismaBookingStatus } from "../generated/prisma/enums";

/**
 * The booking status exists in two places on purpose: as a union in
 * `packages/shared`, so the domain and the UI can reason about it, and as a
 * Postgres enum, so the database refuses an invalid value even if application
 * code is bypassed.
 *
 * Two sources of truth without a check is just a bug with extra steps. This is
 * the check. It fails the moment a status is added to one and not the other,
 * which is the only way that mistake gets caught before a migration lands.
 */
describe("BookingStatus stays in sync between the domain and the database", () => {
  it("has identical members in both directions", () => {
    const fromPrisma = Object.values(PrismaBookingStatus).sort();
    const fromShared = [...BOOKING_STATUSES].sort();

    expect(fromPrisma).toEqual(fromShared);
  });

  it("maps every Prisma value onto the shared type without a cast surprise", () => {
    for (const value of Object.values(PrismaBookingStatus)) {
      // If this stops compiling, the union and the enum have diverged.
      const status: BookingStatus = value;
      expect(BOOKING_STATUSES).toContain(status);
    }
  });

  it("uses the enum name as its own value, so a string read from SQL is usable", () => {
    for (const [name, value] of Object.entries(PrismaBookingStatus)) {
      expect(name).toBe(value);
    }
  });
});
