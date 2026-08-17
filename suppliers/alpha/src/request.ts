/**
 * Query parsing and validation for SupplierAlpha.
 *
 * Deliberately duplicated across the three supplier services rather than
 * factored into a shared package: these are meant to be foreign systems that
 * happen to live in one repo. A shared validator would imply a coordination
 * between suppliers that does not exist in the real world, and would make the
 * differing error contracts below impossible to express.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;

export interface AlphaSearchParams {
  destination: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  nights: number;
}

/** Alpha's error shape: `{ error, message }`. */
export class AlphaRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AlphaRequestError";
  }
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new AlphaRequestError(`${field} is required`);
  }
  return value.trim();
}

function parseDate(value: unknown, field: string): string {
  const raw = requireString(value, field);
  if (!ISO_DATE.test(raw) || Number.isNaN(Date.parse(`${raw}T00:00:00Z`))) {
    throw new AlphaRequestError(`${field} must be an ISO date (YYYY-MM-DD)`);
  }
  return raw;
}

export function nightsBetween(checkIn: string, checkOut: string): number {
  const from = Date.parse(`${checkIn}T00:00:00Z`);
  const to = Date.parse(`${checkOut}T00:00:00Z`);
  return Math.round((to - from) / MS_PER_DAY);
}

export function parseSearchParams(query: Record<string, unknown>): AlphaSearchParams {
  const destination = requireString(query.destination, "destination");
  const checkIn = parseDate(query.checkIn, "checkIn");
  const checkOut = parseDate(query.checkOut, "checkOut");

  const nights = nightsBetween(checkIn, checkOut);
  if (nights < 1) {
    throw new AlphaRequestError("checkOut must be at least one night after checkIn");
  }

  const guestsRaw = query.guests ?? "1";
  const guests = Number(guestsRaw);
  if (!Number.isInteger(guests) || guests < 1 || guests > 8) {
    throw new AlphaRequestError("guests must be a whole number between 1 and 8");
  }

  return { destination, checkIn, checkOut, guests, nights };
}
