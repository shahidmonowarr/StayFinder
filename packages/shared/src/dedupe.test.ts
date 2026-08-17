import { describe, expect, it } from "vitest";
import { compareByPrice, dedupeKeyFor, groupByProperty, normalizePropertyName } from "./dedupe";
import type { HotelOption, SupplierId } from "./hotel-option";
import { fromMinor } from "./money";

function option(
  supplier: SupplierId,
  name: string,
  totalMinor: number,
  overrides: Partial<HotelOption> = {},
): HotelOption {
  const city = overrides.city ?? "Lisbon";
  return {
    id: `${supplier}:${name.toLowerCase().replace(/\W+/g, "-")}`,
    supplier,
    supplierHotelId: name,
    name,
    city,
    starRating: 4,
    nightlyRate: fromMinor(Math.round(totalMinor / 3), "EUR"),
    totalPrice: fromMinor(totalMinor, "EUR"),
    checkIn: "2026-09-01",
    checkOut: "2026-09-04",
    nights: 3,
    guests: 2,
    refundable: true,
    dedupeKey: dedupeKeyFor({ name, city }),
    ...overrides,
  };
}

describe("normalizePropertyName", () => {
  it("strips diacritics", () => {
    expect(normalizePropertyName("Palácio da Ribeira")).toBe("palacio da ribeira");
  });

  it("strips punctuation", () => {
    expect(normalizePropertyName("Grand Meridian, Lisbon")).toBe("grand meridian lisbon");
    expect(normalizePropertyName("Salamanca-Royal")).toBe("salamanca royal");
  });

  it("collapses repeated whitespace and trims", () => {
    expect(normalizePropertyName("  Eixample  Grand   Hotel ")).toBe("eixample grand hotel");
  });

  it("folds case", () => {
    expect(normalizePropertyName("GRAND MERIDIAN LISBON")).toBe("grand meridian lisbon");
  });
});

describe("dedupeKeyFor — the four overlaps SupplierBeta and SupplierGamma seeded", () => {
  const cases: [string, string[]][] = [
    // The comma: Alpha vs Beta vs Gamma.
    [
      "Grand Meridian",
      ["Grand Meridian Lisbon", "Grand Meridian, Lisbon", "GRAND MERIDIAN LISBON"],
    ],
    // The diacritic: Alpha spells it without an accent.
    ["Palacio", ["Palacio da Ribeira", "Palácio da Ribeira", "PALÁCIO DA RIBEIRA"]],
    // The double space, and a fully lowercased variant.
    ["Eixample", ["Eixample Grand Hotel", "Eixample  Grand Hotel", "eixample grand hotel"]],
    // The hyphen.
    ["Salamanca", ["Salamanca Royal", "Salamanca Royal", "Salamanca-Royal"]],
  ];

  it.each(cases)("collapses every spelling of %s to one key", (_label, spellings) => {
    const keys = new Set(spellings.map((name) => dedupeKeyFor({ name, city: "Lisbon" })));

    expect(keys.size).toBe(1);
  });

  it("keeps genuinely different properties apart", () => {
    const keys = new Set(
      ["Casa do Tejo", "Alfama Boutique", "Hotel Baixa Central"].map((name) =>
        dedupeKeyFor({ name, city: "Lisbon" }),
      ),
    );

    expect(keys.size).toBe(3);
  });

  it("does not merge same-named properties in different cities", () => {
    expect(dedupeKeyFor({ name: "Grand Hotel", city: "Lisbon" })).not.toBe(
      dedupeKeyFor({ name: "Grand Hotel", city: "Porto" }),
    );
  });
});

describe("groupByProperty", () => {
  it("merges a three-supplier overlap into one group", () => {
    const groups = groupByProperty([
      option("alpha", "Grand Meridian Lisbon", 38970),
      option("beta", "Grand Meridian, Lisbon", 37500),
      option("gamma", "GRAND MERIDIAN LISBON", 40500),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.offers).toHaveLength(3);
  });

  it("picks the cheapest offer as best, whichever supplier holds it", () => {
    const groups = groupByProperty([
      option("alpha", "Palacio da Ribeira", 42600),
      // Beta is the slowest supplier and also the cheapest here.
      option("beta", "Palácio da Ribeira", 41400),
      option("gamma", "PALÁCIO DA RIBEIRA", 44700),
    ]);

    expect(groups[0]?.best.supplier).toBe("beta");
    expect(groups[0]?.best.totalPrice.amountMinor).toBe(41400);
  });

  it("keeps the losing offers rather than discarding them", () => {
    // A pricier refundable rate is a legitimate choice, so the merge must not
    // delete it — it only decides what to show first.
    const groups = groupByProperty([
      option("alpha", "Grand Meridian Lisbon", 38970, { refundable: true }),
      option("gamma", "GRAND MERIDIAN LISBON", 37000, { refundable: false }),
    ]);

    expect(groups[0]?.best.refundable).toBe(false);
    expect(groups[0]?.offers.map((o) => o.refundable)).toEqual([false, true]);
  });

  it("leaves single-supplier exclusives as one-offer groups", () => {
    const groups = groupByProperty([
      option("alpha", "Alfama Boutique", 18300),
      option("beta", "Hotel Baixa Central", 16200),
    ]);

    expect(groups.map((g) => g.offers.length)).toEqual([1, 1]);
  });

  it("orders groups by their cheapest offer", () => {
    const groups = groupByProperty([
      option("alpha", "Expensive Place", 50000),
      option("alpha", "Cheap Place", 10000),
      option("beta", "Middle Place", 30000),
    ]);

    expect(groups.map((g) => g.best.name)).toEqual([
      "Cheap Place",
      "Middle Place",
      "Expensive Place",
    ]);
  });

  it("produces the same order regardless of input order", () => {
    const options = [
      option("alpha", "Grand Meridian Lisbon", 38970),
      option("beta", "Grand Meridian, Lisbon", 37500),
      option("gamma", "Casa do Tejo", 24300),
      option("alpha", "Casa do Tejo", 25350),
    ];

    const forwards = groupByProperty(options).map((g) => g.best.id);
    const backwards = groupByProperty([...options].reverse()).map((g) => g.best.id);

    expect(forwards).toEqual(backwards);
  });

  it("returns nothing for an empty result set", () => {
    expect(groupByProperty([])).toEqual([]);
  });
});

describe("compareByPrice", () => {
  it("breaks price ties by supplier then id, so ordering is total", () => {
    const a = option("alpha", "Same Price Hotel", 30000);
    const b = option("beta", "Same Price Hotel", 30000);

    expect(compareByPrice(a, b)).toBeLessThan(0);
    expect(compareByPrice(b, a)).toBeGreaterThan(0);
    expect(compareByPrice(a, a)).toBe(0);
  });
});
