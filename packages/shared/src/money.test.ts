import { describe, expect, it } from "vitest";
import {
  MoneyParseError,
  addMoney,
  equalsMoney,
  formatMoney,
  fromDecimalString,
  fromMinor,
  multiplyMoney,
  perNight,
  subtractMoney,
  toDecimalString,
} from "./money";

describe("fromMinor (SupplierAlpha's format)", () => {
  it("accepts integer cents", () => {
    expect(fromMinor(12990, "eur")).toEqual({ amountMinor: 12990, currency: "EUR" });
  });

  it("accepts zero", () => {
    expect(fromMinor(0, "USD").amountMinor).toBe(0);
  });

  it("rejects fractional cents, which would mean the supplier sent a float", () => {
    expect(() => fromMinor(129.9, "EUR")).toThrow(MoneyParseError);
  });

  it("rejects negative prices", () => {
    expect(() => fromMinor(-1, "EUR")).toThrow(MoneyParseError);
  });

  it("rejects malformed currency codes", () => {
    expect(() => fromMinor(100, "EUROS")).toThrow(MoneyParseError);
    expect(() => fromMinor(100, "")).toThrow(MoneyParseError);
  });
});

describe("fromDecimalString (SupplierBeta's format)", () => {
  it("parses a two-decimal string", () => {
    expect(fromDecimalString("129.90", "EUR").amountMinor).toBe(12990);
  });

  it("parses a one-decimal string as tenths, not hundredths", () => {
    expect(fromDecimalString("129.9", "EUR").amountMinor).toBe(12990);
  });

  it("parses a whole-number string", () => {
    expect(fromDecimalString("130", "EUR").amountMinor).toBe(13000);
  });

  it("does not drift on values that float arithmetic rounds badly", () => {
    // 0.29 * 100 === 28.999999999999996 in IEEE-754.
    expect(fromDecimalString("0.29", "USD").amountMinor).toBe(29);
    expect(fromDecimalString("1.005", "USD").amountMinor).toBe(101);
  });

  it("rounds extra precision half-up rather than dropping the rate", () => {
    expect(fromDecimalString("10.994", "USD").amountMinor).toBe(1099);
    expect(fromDecimalString("10.995", "USD").amountMinor).toBe(1100);
  });

  it("rejects anything that is not a plain non-negative decimal", () => {
    for (const bad of ["", "abc", "-5.00", "1,299.00", "€129.90", "1e3", " "]) {
      expect(() => fromDecimalString(bad, "EUR"), `expected "${bad}" to be rejected`).toThrow(
        MoneyParseError,
      );
    }
  });
});

describe("toDecimalString", () => {
  it("round-trips through fromDecimalString", () => {
    expect(toDecimalString(fromDecimalString("129.90", "EUR"))).toBe("129.90");
  });

  it("pads the fractional part", () => {
    expect(toDecimalString(fromMinor(1305, "EUR"))).toBe("13.05");
    expect(toDecimalString(fromMinor(1300, "EUR"))).toBe("13.00");
    expect(toDecimalString(fromMinor(5, "EUR"))).toBe("0.05");
  });
});

describe("arithmetic", () => {
  it("adds and subtracts within a currency", () => {
    const a = fromMinor(1000, "EUR");
    const b = fromMinor(250, "EUR");
    expect(addMoney(a, b).amountMinor).toBe(1250);
    expect(subtractMoney(a, b).amountMinor).toBe(750);
  });

  it("refuses to mix currencies instead of silently averaging them", () => {
    expect(() => addMoney(fromMinor(100, "EUR"), fromMinor(100, "USD"))).toThrow(MoneyParseError);
  });

  it("compares by amount and currency together", () => {
    expect(equalsMoney(fromMinor(100, "EUR"), fromMinor(100, "EUR"))).toBe(true);
    expect(equalsMoney(fromMinor(100, "EUR"), fromMinor(100, "USD"))).toBe(false);
  });
});

describe("nightly <-> total conversion", () => {
  it("multiplies a nightly rate into a stay total (the Alpha direction)", () => {
    expect(multiplyMoney(fromMinor(12990, "EUR"), 3).amountMinor).toBe(38970);
  });

  it("divides a stay total into a nightly rate (the Beta direction)", () => {
    expect(perNight(fromMinor(38970, "EUR"), 3).amountMinor).toBe(12990);
  });

  it("rounds an indivisible total rather than losing a cent", () => {
    // 100.00 over 3 nights is 33.333...; display-grade rounding is fine because
    // the stay total, not the derived nightly rate, is what gets charged.
    expect(perNight(fromMinor(10000, "EUR"), 3).amountMinor).toBe(3333);
  });

  it("rejects stays of less than one whole night", () => {
    expect(() => perNight(fromMinor(10000, "EUR"), 0)).toThrow(MoneyParseError);
    expect(() => perNight(fromMinor(10000, "EUR"), 1.5)).toThrow(MoneyParseError);
  });
});

describe("formatMoney", () => {
  it("renders a currency-labelled price for the UI", () => {
    expect(formatMoney(fromMinor(12990, "USD"))).toBe("$129.90");
  });
});
