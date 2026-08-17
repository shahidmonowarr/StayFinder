/**
 * Money is stored in the currency's *minor unit* (cents) as an integer, never
 * as a float. The three suppliers each report prices differently — Alpha sends
 * integer cents, Beta sends decimal strings like "129.90", Gamma nests the
 * amount inside its GraphQL payload — and every one of them lands here before
 * it becomes a `HotelOption`. Parsing in one place is what keeps rounding bugs
 * out of the aggregation layer.
 *
 * Multi-currency is explicitly out of scope, so a fixed exponent of 2 is
 * assumed. `currency` is carried through only so the UI can label prices and
 * so a mismatched-currency merge can be detected rather than silently averaged.
 */

const MINOR_UNIT_DIGITS = 2;
const MINOR_UNITS_PER_MAJOR = 10 ** MINOR_UNIT_DIGITS;

export interface Money {
  /** Integer amount in the currency's minor unit. 12990 === 129.90 EUR. */
  readonly amountMinor: number;
  /** Uppercase ISO-4217 code, e.g. "EUR". */
  readonly currency: string;
}

/** Thrown when a supplier sends a price this module refuses to guess at. */
export class MoneyParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyParseError";
  }
}

function normalizeCurrency(currency: string): string {
  const code = currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) {
    throw new MoneyParseError(`Expected a 3-letter ISO-4217 code, got "${currency}"`);
  }
  return code;
}

/**
 * Build Money from an integer minor-unit amount — SupplierAlpha's format.
 */
export function fromMinor(amountMinor: number, currency: string): Money {
  if (!Number.isInteger(amountMinor)) {
    throw new MoneyParseError(`Minor-unit amounts must be integers, got ${amountMinor}`);
  }
  if (amountMinor < 0) {
    throw new MoneyParseError(`Prices cannot be negative, got ${amountMinor}`);
  }
  return { amountMinor, currency: normalizeCurrency(currency) };
}

/**
 * Build Money from a decimal string — SupplierBeta's format ("129.90").
 *
 * Parsed by string surgery rather than `parseFloat` so that values like
 * "0.29" cannot drift by a cent. Amounts carrying more precision than the
 * currency supports are rounded half-up, which is what a booking engine wants:
 * refusing the result would drop an otherwise valid rate out of the search.
 */
export function fromDecimalString(value: string, currency: string): Money {
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new MoneyParseError(`Expected a non-negative decimal string, got "${value}"`);
  }

  const [whole = "0", fraction = ""] = trimmed.split(".");
  const padded = fraction.padEnd(MINOR_UNIT_DIGITS + 1, "0");
  const keptDigits = padded.slice(0, MINOR_UNIT_DIGITS);
  const nextDigit = Number(padded[MINOR_UNIT_DIGITS]);

  const amountMinor = Number(whole) * MINOR_UNITS_PER_MAJOR + Number(keptDigits);
  const rounded = nextDigit >= 5 ? amountMinor + 1 : amountMinor;

  if (!Number.isSafeInteger(rounded)) {
    throw new MoneyParseError(`Amount "${value}" is too large to represent exactly`);
  }
  return { amountMinor: rounded, currency: normalizeCurrency(currency) };
}

/** Render as a plain decimal string, e.g. 12990 -> "129.90". */
export function toDecimalString(money: Money): string {
  const whole = Math.trunc(money.amountMinor / MINOR_UNITS_PER_MAJOR);
  const fraction = money.amountMinor % MINOR_UNITS_PER_MAJOR;
  return `${whole}.${String(fraction).padStart(MINOR_UNIT_DIGITS, "0")}`;
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new MoneyParseError(`Currency mismatch: ${a.currency} vs ${b.currency}`);
  }
}

export function addMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { amountMinor: a.amountMinor + b.amountMinor, currency: a.currency };
}

export function subtractMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { amountMinor: a.amountMinor - b.amountMinor, currency: a.currency };
}

export function equalsMoney(a: Money, b: Money): boolean {
  return a.currency === b.currency && a.amountMinor === b.amountMinor;
}

/**
 * Multiply a nightly rate out to a stay total — the Alpha direction, since
 * Alpha only ever quotes per night.
 */
export function multiplyMoney(money: Money, factor: number): Money {
  if (!Number.isInteger(factor) || factor < 0) {
    throw new MoneyParseError(`Expected a non-negative integer factor, got ${factor}`);
  }
  return { amountMinor: money.amountMinor * factor, currency: money.currency };
}

/**
 * Divide a stay total into a nightly rate — the Beta direction, since Beta
 * only ever quotes stay totals.
 *
 * The result is rounded, so `perNight` is display-grade and the stay total
 * stays authoritative. A total of 100.00 over 3 nights shows as 33.33/night
 * and is never re-multiplied back into a charge; the ledger always bills the
 * total the supplier actually quoted.
 */
export function perNight(total: Money, nights: number): Money {
  if (!Number.isInteger(nights) || nights < 1) {
    throw new MoneyParseError(`A stay must be at least 1 whole night, got ${nights}`);
  }
  return { amountMinor: Math.round(total.amountMinor / nights), currency: total.currency };
}

/** Human-readable price for the UI, e.g. "€129.90". */
export function formatMoney(money: Money, locale = "en-US"): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: money.currency,
  }).format(money.amountMinor / MINOR_UNITS_PER_MAJOR);
}
