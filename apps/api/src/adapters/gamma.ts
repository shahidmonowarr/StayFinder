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
  SupplierHotelNotFoundError,
  SupplierPayloadError,
  SupplierResponseError,
  type AdapterResult,
  type QuoteRequest,
  type SupplierAdapter,
  type SupplierQuote,
} from "./types";

/**
 * SupplierGamma: GraphQL, connection-wrapped, deeply nested, and flaky.
 *
 * Two failure modes this adapter has to survive that the others do not:
 *
 * 1. A 20% chance of an opaque HTTP 500 with a plain-text body — no `errors`
 *    array, nothing parseable. Handled by checking the status before touching
 *    the body at all.
 * 2. A well-formed 200 that carries a GraphQL `errors` array instead of data.
 *    GraphQL's habit of reporting failure with HTTP 200 is exactly why status
 *    alone is not enough of a health check.
 */

export const SEARCH_QUERY = /* GraphQL */ `
  query Search($input: SearchInput!) {
    searchHotels(input: $input) {
      totalCount
      edges {
        node {
          id
          maxGuests
          property {
            name
            city
            rating {
              stars
            }
          }
          pricing {
            refundable
            perNight {
              amount
              currency {
                code
              }
            }
          }
        }
      }
    }
  }
`;

const NodeSchema = z.object({
  id: z.string().min(1),
  maxGuests: z.number().int().positive(),
  property: z.object({
    name: z.string().min(1),
    city: z.string().min(1),
    rating: z.object({ stars: z.number().int().min(0).max(5) }),
  }),
  pricing: z.object({
    refundable: z.boolean(),
    perNight: z.object({
      amount: z.number().int().nonnegative(),
      currency: z.object({ code: z.string().length(3) }),
    }),
  }),
});

const EnvelopeSchema = z.object({
  errors: z.array(z.object({ message: z.string() })).optional(),
  data: z
    .object({
      searchHotels: z.object({ edges: z.array(z.unknown()) }),
    })
    .nullish(),
});

export function normalizeGamma(payload: unknown, query: SearchQuery): AdapterResult {
  const envelope = EnvelopeSchema.safeParse(payload);
  if (!envelope.success) {
    throw new SupplierPayloadError("gamma", envelope.error.issues[0]?.message ?? "unknown shape");
  }
  if (envelope.data.errors?.length) {
    throw new SupplierPayloadError("gamma", envelope.data.errors[0]?.message ?? "graphql error");
  }
  if (!envelope.data.data) {
    throw new SupplierPayloadError("gamma", "response carried neither data nor errors");
  }

  const nights = nightsBetween(query.checkIn, query.checkOut);
  const options: HotelOption[] = [];
  let dropped = 0;

  for (const edge of envelope.data.data.searchHotels.edges) {
    const parsed = z.object({ node: NodeSchema }).safeParse(edge);
    if (!parsed.success) {
      dropped += 1;
      continue;
    }

    const node = parsed.data.node;
    try {
      const nightlyRate = fromMinor(
        node.pricing.perNight.amount,
        node.pricing.perNight.currency.code,
      );
      options.push({
        // Gamma's own IDs already look like "gamma:hotel:7", so this doubles the
        // prefix. Kept anyway: the rule is mechanical, which is what guarantees
        // no two adapters can ever mint the same id.
        id: `gamma:${node.id}`,
        supplier: "gamma",
        supplierHotelId: node.id,
        name: node.property.name,
        city: node.property.city,
        starRating: node.property.rating.stars,
        nightlyRate,
        totalPrice: multiplyMoney(nightlyRate, nights),
        checkIn: query.checkIn,
        checkOut: query.checkOut,
        nights,
        guests: query.guests,
        refundable: node.pricing.refundable,
        dedupeKey: dedupeKeyFor(node.property),
      });
    } catch {
      dropped += 1;
    }
  }

  return { options, dropped };
}

export const QUOTE_QUERY = /* GraphQL */ `
  query Quote($input: QuoteInput!) {
    hotelQuote(input: $input) {
      hotelId
      nights
      priceChanged
      property {
        name
        city
        rating {
          stars
        }
      }
      pricing {
        refundable
        perNight {
          amount
          currency {
            code
          }
        }
      }
    }
  }
`;

const QuoteEnvelopeSchema = z.object({
  errors: z.array(z.object({ message: z.string(), extensions: z.unknown().optional() })).optional(),
  data: z
    .object({
      hotelQuote: z.object({
        hotelId: z.string().min(1),
        nights: z.number().int().positive(),
        priceChanged: z.boolean(),
        property: z.object({
          name: z.string().min(1),
          city: z.string().min(1),
          rating: z.object({ stars: z.number().int().min(0).max(5) }),
        }),
        pricing: z.object({
          refundable: z.boolean(),
          perNight: z.object({
            amount: z.number().int().nonnegative(),
            currency: z.object({ code: z.string().length(3) }),
          }),
        }),
      }),
    })
    .nullish(),
});

function errorCodeOf(error: { extensions?: unknown }): string | undefined {
  const extensions = error.extensions;
  if (typeof extensions !== "object" || extensions === null) return undefined;
  const code = (extensions as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

export function normalizeGammaQuote(payload: unknown, supplierHotelId: string): SupplierQuote {
  const envelope = QuoteEnvelopeSchema.safeParse(payload);
  if (!envelope.success) {
    throw new SupplierPayloadError("gamma", envelope.error.issues[0]?.message ?? "unknown shape");
  }

  const failure = envelope.data.errors?.[0];
  if (failure !== undefined) {
    // Gamma reports a missing property as a typed GraphQL error over HTTP 200,
    // so the distinction between "no such hotel" and "Gamma is broken" is inside
    // the body rather than in the status code.
    if (errorCodeOf(failure) === "HOTEL_NOT_FOUND") {
      throw new SupplierHotelNotFoundError("gamma", supplierHotelId);
    }
    throw new SupplierPayloadError("gamma", failure.message);
  }
  if (!envelope.data.data) {
    throw new SupplierPayloadError("gamma", "response carried neither data nor errors");
  }

  const quote = envelope.data.data.hotelQuote;
  const nightlyRate = fromMinor(
    quote.pricing.perNight.amount,
    quote.pricing.perNight.currency.code,
  );

  // `priceChanged` from Gamma is deliberately ignored. A real supplier would not
  // volunteer that it just moved the price, so the aggregator compares the
  // amounts itself and treats the flag as decoration.
  return {
    supplier: "gamma",
    supplierHotelId: quote.hotelId,
    hotelName: quote.property.name,
    city: quote.property.city,
    starRating: quote.property.rating.stars,
    nightlyRate,
    totalPrice: multiplyMoney(nightlyRate, quote.nights),
    nights: quote.nights,
    refundable: quote.pricing.refundable,
  };
}

export function createGammaAdapter(baseUrl: string): SupplierAdapter {
  return {
    id: "gamma",

    async search(query, signal) {
      const response = await fetch(new URL("/graphql", baseUrl), {
        method: "POST",
        signal,
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          query: SEARCH_QUERY,
          variables: {
            input: {
              destination: query.destination,
              checkIn: query.checkIn,
              checkOut: query.checkOut,
              guests: query.guests,
            },
          },
        }),
      });

      // Checked before reading the body: Gamma's injected failure is a
      // plain-text 500, and calling .json() on it would throw a parse error
      // that says nothing useful about what went wrong.
      if (!response.ok) {
        throw new SupplierResponseError("gamma", response.status);
      }

      return normalizeGamma(await response.json(), query);
    },

    async quote(request: QuoteRequest, signal) {
      const response = await fetch(new URL("/graphql", baseUrl), {
        method: "POST",
        signal,
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          query: QUOTE_QUERY,
          variables: {
            input: {
              hotelId: request.supplierHotelId,
              checkIn: request.checkIn,
              checkOut: request.checkOut,
              guests: request.guests,
            },
          },
        }),
      });

      if (!response.ok) {
        throw new SupplierResponseError("gamma", response.status);
      }

      return normalizeGammaQuote(await response.json(), request.supplierHotelId);
    },
  };
}
