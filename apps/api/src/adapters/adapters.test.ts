import { toDecimalString, type SearchQuery } from "@stayfinder/shared";
import { describe, expect, it } from "vitest";
import { normalizeAlpha } from "./alpha";
import { normalizeBeta, parseCategory, toCityCode } from "./beta";
import {
  ALPHA_SEARCH_PAYLOAD,
  BETA_SEARCH_PAYLOAD,
  GAMMA_ERROR_PAYLOAD,
  GAMMA_SEARCH_PAYLOAD,
} from "./fixtures";
import { normalizeGamma } from "./gamma";
import { SupplierPayloadError } from "./types";

const QUERY: SearchQuery = {
  destination: "Lisbon",
  checkIn: "2026-09-01",
  checkOut: "2026-09-04",
  guests: 2,
};

describe("Alpha normalization", () => {
  const { options, dropped } = normalizeAlpha(ALPHA_SEARCH_PAYLOAD, QUERY);

  it("maps every row", () => {
    expect(options).toHaveLength(3);
    expect(dropped).toBe(0);
  });

  it("keeps the nightly rate Alpha quoted and derives the stay total", () => {
    const grandMeridian = options[0]!;

    expect(grandMeridian.nightlyRate.amountMinor).toBe(12990);
    // 12990 × 3 nights — Alpha never reports a total, so this is computed.
    expect(grandMeridian.totalPrice.amountMinor).toBe(38970);
    expect(toDecimalString(grandMeridian.totalPrice)).toBe("389.70");
  });

  it("namespaces the id and keeps the supplier's own key for re-quoting", () => {
    expect(options[0]!.id).toBe("alpha:ALPHA-1042");
    expect(options[0]!.supplierHotelId).toBe("ALPHA-1042");
  });

  it("echoes the stay back onto every option", () => {
    expect(options.every((o) => o.nights === 3 && o.guests === 2)).toBe(true);
    expect(options.every((o) => o.checkIn === "2026-09-01")).toBe(true);
  });

  it("drops an unparseable row without losing the rest", () => {
    const result = normalizeAlpha(
      { hotels: [{ hotelId: "BAD" }, ...ALPHA_SEARCH_PAYLOAD.hotels] },
      QUERY,
    );

    expect(result.options).toHaveLength(3);
    expect(result.dropped).toBe(1);
  });

  it("drops a row whose price Money refuses rather than failing the supplier", () => {
    const result = normalizeAlpha(
      {
        hotels: [
          { ...ALPHA_SEARCH_PAYLOAD.hotels[0], currency: "EUROS" },
          ALPHA_SEARCH_PAYLOAD.hotels[1],
        ],
      },
      QUERY,
    );

    expect(result.options).toHaveLength(1);
    expect(result.dropped).toBe(1);
  });

  it("fails the leg when the envelope itself is wrong", () => {
    expect(() => normalizeAlpha({ notHotels: [] }, QUERY)).toThrow(SupplierPayloadError);
  });
});

describe("Beta normalization", () => {
  const { options, dropped } = normalizeBeta(BETA_SEARCH_PAYLOAD, QUERY);

  it("maps every row", () => {
    expect(options).toHaveLength(2);
    expect(dropped).toBe(0);
  });

  it("parses the decimal string exactly and divides out a nightly rate", () => {
    const grandMeridian = options[0]!;

    // "375.00" is the whole stay; 375.00 / 3 = 125.00 a night.
    expect(grandMeridian.totalPrice.amountMinor).toBe(37500);
    expect(grandMeridian.nightlyRate.amountMinor).toBe(12500);
  });

  it("undercuts Alpha on the same property — the slowest supplier is cheapest", () => {
    const alpha = normalizeAlpha(ALPHA_SEARCH_PAYLOAD, QUERY).options[0]!;

    expect(options[0]!.totalPrice.amountMinor).toBeLessThan(alpha.totalPrice.amountMinor);
    expect(options[0]!.dedupeKey).toBe(alpha.dedupeKey);
  });

  it("normalizes a missing category to unrated rather than guessing", () => {
    expect(options[0]!.starRating).toBe(4);
    expect(options[1]!.starRating).toBe(0);
  });

  it("translates the cancellation policy into a boolean", () => {
    expect(options[0]!.refundable).toBe(true);
    expect(options[1]!.refundable).toBe(false);
  });

  it("fails the leg when the envelope itself is wrong", () => {
    expect(() => normalizeBeta({ results: "nope" }, QUERY)).toThrow(SupplierPayloadError);
  });
});

describe("Beta's destination mapping", () => {
  it("maps known city names to codes, case-insensitively", () => {
    expect(toCityCode("Lisbon")).toBe("LIS");
    expect(toCityCode("  porto ")).toBe("OPO");
    expect(toCityCode("BARCELONA")).toBe("BCN");
    expect(toCityCode("Madrid")).toBe("MAD");
  });

  it("returns nothing for a destination Beta has no code for", () => {
    expect(toCityCode("Atlantis")).toBeUndefined();
  });
});

describe("Beta's category parsing", () => {
  it("extracts the star count", () => {
    expect(parseCategory("4_STAR")).toBe(4);
    expect(parseCategory("5_STAR")).toBe(5);
  });

  it("treats absent or unrecognized categories as unrated", () => {
    expect(parseCategory(undefined)).toBe(0);
    expect(parseCategory("LUXURY")).toBe(0);
    expect(parseCategory("9_STAR")).toBe(0);
  });
});

describe("Gamma normalization", () => {
  const { options, dropped } = normalizeGamma(GAMMA_SEARCH_PAYLOAD, QUERY);

  it("maps every edge", () => {
    expect(options).toHaveLength(2);
    expect(dropped).toBe(0);
  });

  it("digs the price out of the nested pricing object", () => {
    expect(options[0]!.nightlyRate.amountMinor).toBe(13500);
    expect(options[0]!.nightlyRate.currency).toBe("EUR");
    expect(options[0]!.totalPrice.amountMinor).toBe(40500);
  });

  it("flattens the nested property and rating", () => {
    expect(options[0]!.name).toBe("GRAND MERIDIAN LISBON");
    expect(options[0]!.city).toBe("Lisbon");
    expect(options[0]!.starRating).toBe(5);
  });

  it("agrees with the other suppliers on identity despite shouting the name", () => {
    const alpha = normalizeAlpha(ALPHA_SEARCH_PAYLOAD, QUERY).options[0]!;
    const beta = normalizeBeta(BETA_SEARCH_PAYLOAD, QUERY).options[0]!;

    expect(options[0]!.dedupeKey).toBe(alpha.dedupeKey);
    expect(options[0]!.dedupeKey).toBe(beta.dedupeKey);
  });

  it("disagrees with Alpha about refundability, which merging must preserve", () => {
    const alpha = normalizeAlpha(ALPHA_SEARCH_PAYLOAD, QUERY).options[0]!;

    expect(alpha.refundable).toBe(true);
    expect(options[0]!.refundable).toBe(false);
  });

  it("treats a 200 carrying a GraphQL errors array as a failure", () => {
    // GraphQL reports failure with HTTP 200, so checking the status is not
    // enough — the adapter has to look inside.
    expect(() => normalizeGamma(GAMMA_ERROR_PAYLOAD, QUERY)).toThrow(SupplierPayloadError);
  });

  it("rejects a response carrying neither data nor errors", () => {
    expect(() => normalizeGamma({ data: null }, QUERY)).toThrow(/neither data nor errors/);
  });

  it("drops a malformed edge without losing the rest", () => {
    const result = normalizeGamma(
      {
        data: {
          searchHotels: {
            edges: [
              { node: { id: "gamma:hotel:99" } },
              ...GAMMA_SEARCH_PAYLOAD.data.searchHotels.edges,
            ],
          },
        },
      },
      QUERY,
    );

    expect(result.options).toHaveLength(2);
    expect(result.dropped).toBe(1);
  });
});

describe("all three adapters together", () => {
  it("produce one model with both price bases populated, whatever the supplier quoted", () => {
    const everything = [
      ...normalizeAlpha(ALPHA_SEARCH_PAYLOAD, QUERY).options,
      ...normalizeBeta(BETA_SEARCH_PAYLOAD, QUERY).options,
      ...normalizeGamma(GAMMA_SEARCH_PAYLOAD, QUERY).options,
    ];

    expect(everything).toHaveLength(7);
    for (const item of everything) {
      expect(item.nightlyRate.amountMinor).toBeGreaterThan(0);
      expect(item.totalPrice.amountMinor).toBeGreaterThan(0);
      expect(item.nightlyRate.currency).toBe("EUR");
      expect(item.totalPrice.currency).toBe("EUR");
    }
  });
});
