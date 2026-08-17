import {
  dedupeKeyFor,
  fromDecimalString,
  nightsBetween,
  perNight,
  type HotelOption,
  type SearchQuery,
} from "@stayfinder/shared";
import { z } from "zod";
import {
  SupplierHotelNotFoundError,
  SupplierPayloadError,
  SupplierResponseError,
  type AdapterResult,
  type QuoteRequest,
  type SupplierAdapter,
  type SupplierQuote,
} from "./types";

/**
 * SupplierBeta: REST, snake_case, decimal-string prices, stay totals only.
 *
 * Three normalizations happen here that no other adapter needs:
 *
 * 1. Destinations are looked up as city codes — Beta has no idea what "Lisbon"
 *    means. This map is the miniature version of the destination-mapping table
 *    every real supplier integration carries.
 * 2. Prices arrive as decimal strings and go through `fromDecimalString`, never
 *    `parseFloat`.
 * 3. Beta quotes the whole stay, so the nightly rate is derived by division.
 */

const CITY_CODES: Record<string, string> = {
  lisbon: "LIS",
  porto: "OPO",
  barcelona: "BCN",
  madrid: "MAD",
};

export function toCityCode(destination: string): string | undefined {
  return CITY_CODES[destination.trim().toLowerCase()];
}

/** "4_STAR" → 4. Absent or unrecognized → 0, meaning "unrated". */
export function parseCategory(category: string | undefined): number {
  if (category === undefined) return 0;
  const match = /^([1-5])_STAR$/.exec(category);
  return match ? Number(match[1]) : 0;
}

const RowSchema = z.object({
  hotel_id: z.string().min(1),
  hotel_name: z.string().min(1),
  city_name: z.string().min(1),
  // Optional, because Beta omits the key entirely for unclassified properties.
  category: z.string().optional(),
  total_price: z.string(),
  currency: z.string().length(3),
  cancellation_policy: z.string(),
  max_occupancy: z.number().int().positive(),
  nights: z.number().int().positive(),
});

const EnvelopeSchema = z.object({
  results: z.array(z.unknown()),
});

export function normalizeBeta(payload: unknown, query: SearchQuery): AdapterResult {
  const envelope = EnvelopeSchema.safeParse(payload);
  if (!envelope.success) {
    throw new SupplierPayloadError("beta", envelope.error.issues[0]?.message ?? "unknown shape");
  }

  const nights = nightsBetween(query.checkIn, query.checkOut);
  const options: HotelOption[] = [];
  let dropped = 0;

  for (const raw of envelope.data.results) {
    const row = RowSchema.safeParse(raw);
    if (!row.success) {
      dropped += 1;
      continue;
    }

    const hotel = row.data;
    try {
      const totalPrice = fromDecimalString(hotel.total_price, hotel.currency);
      options.push({
        id: `beta:${hotel.hotel_id}`,
        supplier: "beta",
        supplierHotelId: hotel.hotel_id,
        name: hotel.hotel_name,
        city: hotel.city_name,
        starRating: parseCategory(hotel.category),
        // Derived, and display-grade: the stay total Beta quoted stays
        // authoritative for anything that gets charged.
        nightlyRate: perNight(totalPrice, nights),
        totalPrice,
        checkIn: query.checkIn,
        checkOut: query.checkOut,
        nights,
        guests: query.guests,
        refundable: hotel.cancellation_policy === "FREE_CANCELLATION",
        dedupeKey: dedupeKeyFor({ name: hotel.hotel_name, city: hotel.city_name }),
      });
    } catch {
      dropped += 1;
    }
  }

  return { options, dropped };
}

const QuoteSchema = z.object({
  hotel_id: z.string().min(1),
  hotel_name: z.string().min(1),
  city_name: z.string().min(1),
  category: z.string().optional(),
  total_price: z.string(),
  currency: z.string().length(3),
  nights: z.number().int().positive(),
  cancellation_policy: z.string(),
});

export function normalizeBetaQuote(payload: unknown): SupplierQuote {
  const parsed = QuoteSchema.safeParse(payload);
  if (!parsed.success) {
    throw new SupplierPayloadError("beta", parsed.error.issues[0]?.message ?? "unknown shape");
  }

  const quote = parsed.data;
  const totalPrice = fromDecimalString(quote.total_price, quote.currency);
  return {
    supplier: "beta",
    supplierHotelId: quote.hotel_id,
    hotelName: quote.hotel_name,
    city: quote.city_name,
    starRating: parseCategory(quote.category),
    nightlyRate: perNight(totalPrice, quote.nights),
    totalPrice,
    nights: quote.nights,
    refundable: quote.cancellation_policy === "FREE_CANCELLATION",
  };
}

export function createBetaAdapter(baseUrl: string): SupplierAdapter {
  return {
    id: "beta",

    async search(query, signal) {
      const code = toCityCode(query.destination);
      if (code === undefined) {
        // Beta cannot be asked about a destination we have no code for. That is
        // an empty result, not a failure — the other suppliers may well know it.
        return { options: [], dropped: 0 };
      }

      const url = new URL("/v1/availability", baseUrl);
      url.searchParams.set("destination_code", code);
      url.searchParams.set("check_in_date", query.checkIn);
      url.searchParams.set("check_out_date", query.checkOut);
      url.searchParams.set("occupancy", String(query.guests));

      const response = await fetch(url, { signal, headers: { accept: "application/json" } });
      if (!response.ok) {
        throw new SupplierResponseError("beta", response.status);
      }

      return normalizeBeta(await response.json(), query);
    },

    async quote(request: QuoteRequest, signal) {
      const url = new URL(
        `/v1/availability/${encodeURIComponent(request.supplierHotelId)}/price`,
        baseUrl,
      );
      url.searchParams.set("check_in_date", request.checkIn);
      url.searchParams.set("check_out_date", request.checkOut);
      url.searchParams.set("occupancy", String(request.guests));

      const response = await fetch(url, { signal, headers: { accept: "application/json" } });
      if (response.status === 404) {
        throw new SupplierHotelNotFoundError("beta", request.supplierHotelId);
      }
      if (!response.ok) {
        throw new SupplierResponseError("beta", response.status);
      }

      return normalizeBetaQuote(await response.json());
    },
  };
}
