import { nightsBetween, type SearchQuery } from "@stayfinder/shared";
import { z } from "zod";

/**
 * The public request contract for `/api/search`.
 *
 * Validated with a schema rather than by hand because this is the boundary the
 * outside world touches, and because M5's booking bodies and M6's webhook
 * payloads need the same treatment — one validator, not four.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Rejects "2026-02-31": the regex shape passes, the calendar does not. */
function isRealDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

const DateField = z
  .string()
  .regex(ISO_DATE, "must be formatted YYYY-MM-DD")
  .refine(isRealDate, "must be a real calendar date");

export const SearchRequestSchema = z
  .object({
    destination: z.string().trim().min(1, "is required"),
    checkIn: DateField,
    checkOut: DateField,
    // Query strings are always strings; coerce, then insist on a whole number.
    guests: z.coerce.number().int().min(1).max(8).default(2),
  })
  .refine((value) => nightsBetween(value.checkIn, value.checkOut) >= 1, {
    message: "checkOut must be at least one night after checkIn",
    path: ["checkOut"],
  })
  .refine((value) => nightsBetween(value.checkIn, value.checkOut) <= 30, {
    message: "stays longer than 30 nights are not supported",
    path: ["checkOut"],
  });

export interface SearchRequestIssue {
  field: string;
  message: string;
}

export type ParseResult =
  { ok: true; query: SearchQuery } | { ok: false; issues: SearchRequestIssue[] };

export function parseSearchRequest(input: unknown): ParseResult {
  const parsed = SearchRequestSchema.safeParse(input);
  if (parsed.success) {
    return { ok: true, query: parsed.data };
  }

  return {
    ok: false,
    issues: parsed.error.issues.map((issue) => ({
      field: issue.path.join(".") || "request",
      message: issue.message,
    })),
  };
}
