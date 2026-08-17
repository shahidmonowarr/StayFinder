import { describe, expect, it } from "vitest";
import { uniqueViolationFields } from "./bookings";

/**
 * These fixtures are copied verbatim from a real Prisma 7 error, captured by
 * provoking a duplicate insert against Postgres 17 through the pg driver adapter.
 *
 * They exist because the first version of this parsing read `meta.target`, which
 * Prisma 7 with an adapter does not populate — so conflict recovery never ran and
 * a duplicate booking surfaced as a 500. The behavioural test did not catch it:
 * the pre-flight lookup absorbed every race, so the constraint path was never
 * reached. Asserting the shape directly is the only way to know this works.
 */
const PRISMA_7_ADAPTER_ERROR = {
  name: "PrismaClientKnownRequestError",
  code: "P2002",
  meta: {
    modelName: "Booking",
    driverAdapterError: {
      name: "DriverAdapterError",
      cause: {
        originalCode: "23505",
        originalMessage: 'duplicate key value violates unique constraint "Booking_quoteId_key"',
        kind: "UniqueConstraintViolation",
        // Note the embedded quotes — these come straight from Postgres.
        constraint: { fields: ['"quoteId"'] },
      },
    },
  },
};

const LEGACY_PRISMA_ERROR = {
  name: "PrismaClientKnownRequestError",
  code: "P2002",
  meta: { target: ["idempotencyKey"] },
};

describe("uniqueViolationFields", () => {
  it("reads the Prisma 7 driver-adapter shape and strips the quoting", () => {
    expect(uniqueViolationFields(PRISMA_7_ADAPTER_ERROR)).toEqual(["quoteId"]);
  });

  it("still reads the flat meta.target shape", () => {
    expect(uniqueViolationFields(LEGACY_PRISMA_ERROR)).toEqual(["idempotencyKey"]);
  });

  it("reads a string target as a single field", () => {
    expect(uniqueViolationFields({ code: "P2002", meta: { target: '"idempotencyKey"' } })).toEqual([
      "idempotencyKey",
    ]);
  });

  it("handles a composite constraint", () => {
    expect(
      uniqueViolationFields({
        code: "P2002",
        meta: { driverAdapterError: { cause: { constraint: { fields: ['"a"', '"b"'] } } } },
      }),
    ).toEqual(["a", "b"]);
  });

  it("ignores errors that are not unique violations", () => {
    expect(uniqueViolationFields({ code: "P2025", meta: { target: ["id"] } })).toEqual([]);
  });

  it("survives anything that is not a Prisma error at all", () => {
    expect(uniqueViolationFields(new Error("boom"))).toEqual([]);
    expect(uniqueViolationFields(null)).toEqual([]);
    expect(uniqueViolationFields(undefined)).toEqual([]);
    expect(uniqueViolationFields("P2002")).toEqual([]);
    expect(uniqueViolationFields({ code: "P2002" })).toEqual([]);
    expect(uniqueViolationFields({ code: "P2002", meta: {} })).toEqual([]);
  });
});
