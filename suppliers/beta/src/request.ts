/**
 * Query parsing and validation for SupplierBeta.
 *
 * Duplicated from the other suppliers on purpose — see the note in
 * SupplierAlpha's request module. Beta's parameter names and error contract
 * are its own, and that is exactly what the aggregator's adapter layer exists
 * to absorb.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;

export interface BetaSearchParams {
  destination_code: string;
  check_in_date: string;
  check_out_date: string;
  occupancy: number;
  nights: number;
}

/** Beta's error shape: `{ error_code, error_message }`. */
export class BetaRequestError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "BetaRequestError";
    this.code = code;
  }
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new BetaRequestError("missing_parameter", `${field} is required`);
  }
  return value.trim();
}

function parseDate(value: unknown, field: string): string {
  const raw = requireString(value, field);
  if (!ISO_DATE.test(raw) || Number.isNaN(Date.parse(`${raw}T00:00:00Z`))) {
    throw new BetaRequestError("invalid_date", `${field} must be formatted YYYY-MM-DD`);
  }
  return raw;
}

export function nightsBetween(checkIn: string, checkOut: string): number {
  const from = Date.parse(`${checkIn}T00:00:00Z`);
  const to = Date.parse(`${checkOut}T00:00:00Z`);
  return Math.round((to - from) / MS_PER_DAY);
}

export function parseStayParams(
  query: Record<string, unknown>,
): Omit<BetaSearchParams, "destination_code"> {
  const check_in_date = parseDate(query.check_in_date, "check_in_date");
  const check_out_date = parseDate(query.check_out_date, "check_out_date");

  const nights = nightsBetween(check_in_date, check_out_date);
  if (nights < 1) {
    throw new BetaRequestError(
      "invalid_stay",
      "check_out_date must be at least one night after check_in_date",
    );
  }

  const occupancy = Number(query.occupancy ?? "1");
  if (!Number.isInteger(occupancy) || occupancy < 1 || occupancy > 8) {
    throw new BetaRequestError("invalid_occupancy", "occupancy must be between 1 and 8");
  }

  return { check_in_date, check_out_date, occupancy, nights };
}

export function parseSearchParams(query: Record<string, unknown>): BetaSearchParams {
  const destination_code = requireString(query.destination_code, "destination_code").toUpperCase();
  if (!/^[A-Z]{3}$/.test(destination_code)) {
    throw new BetaRequestError("invalid_destination", "destination_code must be a 3-letter code");
  }
  return { destination_code, ...parseStayParams(query) };
}

/**
 * Beta serializes money as a decimal string with the currency in its own
 * field — the format that makes `parseFloat` on the consuming side a bug
 * waiting to happen.
 */
export function toDecimalString(amountCents: number): string {
  const whole = Math.trunc(amountCents / 100);
  const fraction = amountCents % 100;
  return `${whole}.${String(fraction).padStart(2, "0")}`;
}
