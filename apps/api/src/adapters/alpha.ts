import {
  dedupeKeyFor,
  fromMinor,
  multiplyMoney,
  nightsBetween,
  type HotelOption,
  type SearchQuery,
} from "@stayfinder/shared";
import { z } from "zod";
import {
  SupplierPayloadError,
  SupplierResponseError,
  type AdapterResult,
  type SupplierAdapter,
} from "./types";

/**
 * SupplierAlpha: REST, camelCase, integer cents, per-night only.
 *
 * The simplest of the three. Its one normalization job is multiplying the
 * nightly rate out to a stay total, since Alpha never reports one.
 */

const RowSchema = z.object({
  hotelId: z.string().min(1),
  name: z.string().min(1),
  city: z.string().min(1),
  starRating: z.number().int().min(0).max(5),
  nightlyRateCents: z.number().int().nonnegative(),
  currency: z.string().length(3),
  refundable: z.boolean(),
  maxGuests: z.number().int().positive(),
});

/**
 * Rows arrive as `unknown` on purpose. The envelope must parse or the whole leg
 * fails, but each row is validated independently so one malformed rate cannot
 * cost us the other nine.
 */
const EnvelopeSchema = z.object({
  hotels: z.array(z.unknown()),
});

export function normalizeAlpha(payload: unknown, query: SearchQuery): AdapterResult {
  const envelope = EnvelopeSchema.safeParse(payload);
  if (!envelope.success) {
    throw new SupplierPayloadError("alpha", envelope.error.issues[0]?.message ?? "unknown shape");
  }

  const nights = nightsBetween(query.checkIn, query.checkOut);
  const options: HotelOption[] = [];
  let dropped = 0;

  for (const raw of envelope.data.hotels) {
    const row = RowSchema.safeParse(raw);
    if (!row.success) {
      dropped += 1;
      continue;
    }

    const hotel = row.data;
    try {
      const nightlyRate = fromMinor(hotel.nightlyRateCents, hotel.currency);
      options.push({
        id: `alpha:${hotel.hotelId}`,
        supplier: "alpha",
        supplierHotelId: hotel.hotelId,
        name: hotel.name,
        city: hotel.city,
        starRating: hotel.starRating,
        nightlyRate,
        // Alpha quotes per night and nothing else, so the stay total is derived.
        totalPrice: multiplyMoney(nightlyRate, nights),
        checkIn: query.checkIn,
        checkOut: query.checkOut,
        nights,
        guests: query.guests,
        refundable: hotel.refundable,
        dedupeKey: dedupeKeyFor(hotel),
      });
    } catch {
      // A price Money refuses to parse loses the row, not the supplier.
      dropped += 1;
    }
  }

  return { options, dropped };
}

export function createAlphaAdapter(baseUrl: string): SupplierAdapter {
  return {
    id: "alpha",

    async search(query, signal) {
      const url = new URL("/hotels", baseUrl);
      url.searchParams.set("destination", query.destination);
      url.searchParams.set("checkIn", query.checkIn);
      url.searchParams.set("checkOut", query.checkOut);
      url.searchParams.set("guests", String(query.guests));

      const response = await fetch(url, { signal, headers: { accept: "application/json" } });
      if (!response.ok) {
        throw new SupplierResponseError("alpha", response.status);
      }

      return normalizeAlpha(await response.json(), query);
    },
  };
}
