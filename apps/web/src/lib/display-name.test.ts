import { dedupeKeyFor, fromMinor, type HotelOption, type SupplierId } from "@stayfinder/shared";
import { describe, expect, it } from "vitest";
import { pickDisplayName } from "./display-name";

function offer(supplier: SupplierId, name: string): HotelOption {
  return {
    id: `${supplier}:${name}`,
    supplier,
    supplierHotelId: name,
    name,
    city: "Lisbon",
    starRating: 4,
    nightlyRate: fromMinor(10000, "EUR"),
    totalPrice: fromMinor(30000, "EUR"),
    checkIn: "2026-09-01",
    checkOut: "2026-09-04",
    nights: 3,
    guests: 2,
    refundable: true,
    dedupeKey: dedupeKeyFor({ name, city: "Lisbon" }),
  };
}

describe("pickDisplayName", () => {
  it("prefers a sentence-shaped name over a shouted one", () => {
    // Gamma is often cheapest, so without this the card SHOUTS whenever it wins.
    const name = pickDisplayName([
      offer("gamma", "GRAND MERIDIAN LISBON"),
      offer("alpha", "Grand Meridian Lisbon"),
    ]);

    expect(name).toBe("Grand Meridian Lisbon");
  });

  it("prefers a sentence-shaped name over a lowercased one", () => {
    const name = pickDisplayName([
      offer("gamma", "eixample grand hotel"),
      offer("alpha", "Eixample Grand Hotel"),
    ]);

    expect(name).toBe("Eixample Grand Hotel");
  });

  it("keeps the supplier's own spelling when it is already usable", () => {
    // Punctuation is the supplier's business; only casing gets normalized.
    expect(pickDisplayName([offer("beta", "Grand Meridian, Lisbon")])).toBe(
      "Grand Meridian, Lisbon",
    );
  });

  it("re-cases when every supplier shouts", () => {
    expect(pickDisplayName([offer("gamma", "CASA DO TEJO")])).toBe("Casa Do Tejo");
  });

  it("re-cases when every supplier whispers", () => {
    expect(pickDisplayName([offer("gamma", "casa do tejo")])).toBe("Casa Do Tejo");
  });

  it("handles accented names without mangling them", () => {
    expect(pickDisplayName([offer("gamma", "PALÁCIO DA RIBEIRA")])).toBe("Palácio Da Ribeira");
  });

  it("survives an empty offer list", () => {
    expect(pickDisplayName([])).toBe("");
  });
});
