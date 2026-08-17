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
  };
}
