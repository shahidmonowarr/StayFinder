import { createGraphQLError, createSchema } from "graphql-yoga";
import type { Chaos, ChaosOverride } from "./chaos";
import { findHotel, searchInventory, type GammaHotel } from "./inventory";

/**
 * Gamma's schema is nested well past the point of convenience: a price lives at
 * `pricing.perNight.amount` and its currency at `pricing.perNight.currency.code`.
 * That is the shape the M3 adapter has to flatten, and it is not a caricature —
 * connection/edge/node wrappers around a deeply modelled property are ordinary
 * in supplier GraphQL APIs.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;

const CURRENCY_SYMBOLS: Record<string, string> = { EUR: "€", USD: "$", GBP: "£" };

export interface GammaContext {
  chaos: Chaos;
  override: ChaosOverride | undefined;
}

interface SearchInput {
  destination: string;
  checkIn: string;
  checkOut: string;
  guests?: number | null;
}

interface QuoteInput {
  hotelId: string;
  checkIn: string;
  checkOut: string;
  guests?: number | null;
}

export const typeDefs = /* GraphQL */ `
  type Currency {
    code: String!
    symbol: String!
  }

  type Amount {
    amount: Int!
    currency: Currency!
  }

  type Pricing {
    perNight: Amount!
    refundable: Boolean!
  }

  type Rating {
    stars: Int!
  }

  type Property {
    name: String!
    city: String!
    rating: Rating!
  }

  type HotelNode {
    id: ID!
    property: Property!
    pricing: Pricing!
    maxGuests: Int!
  }

  type HotelEdge {
    node: HotelNode!
  }

  type HotelConnection {
    edges: [HotelEdge!]!
    totalCount: Int!
  }

  type QuoteResult {
    hotelId: ID!
    property: Property!
    pricing: Pricing!
    nights: Int!
    "True when this quote disagrees with the price search advertised."
    priceChanged: Boolean!
  }

  input SearchInput {
    destination: String!
    checkIn: String!
    checkOut: String!
    guests: Int
  }

  input QuoteInput {
    hotelId: ID!
    checkIn: String!
    checkOut: String!
    guests: Int
  }

  type Query {
    searchHotels(input: SearchInput!): HotelConnection!
    hotelQuote(input: QuoteInput!): QuoteResult!
  }
`;

function badRequest(message: string) {
  // Yoga masks unexpected resolver errors by default; errors built with its own
  // factory are the ones it treats as intentional and passes through intact.
  return createGraphQLError(message, { extensions: { code: "BAD_USER_INPUT" } });
}

function assertDate(value: string, field: string): void {
  if (!ISO_DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw badRequest(`${field} must be an ISO date (YYYY-MM-DD)`);
  }
}

function nightsBetween(checkIn: string, checkOut: string): number {
  assertDate(checkIn, "checkIn");
  assertDate(checkOut, "checkOut");
  const nights = Math.round(
    (Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / MS_PER_DAY,
  );
  if (nights < 1) {
    throw badRequest("checkOut must be at least one night after checkIn");
  }
  return nights;
}

function normalizeGuests(guests: number | null | undefined): number {
  const value = guests ?? 1;
  if (!Number.isInteger(value) || value < 1 || value > 8) {
    throw badRequest("guests must be a whole number between 1 and 8");
  }
  return value;
}

function pricing(hotel: GammaHotel, amount: number) {
  return {
    perNight: {
      amount,
      currency: {
        code: hotel.currencyCode,
        symbol: CURRENCY_SYMBOLS[hotel.currencyCode] ?? hotel.currencyCode,
      },
    },
    refundable: hotel.refundable,
  };
}

function toNode(hotel: GammaHotel) {
  return {
    id: hotel.id,
    property: {
      name: hotel.name,
      city: hotel.city,
      rating: { stars: hotel.stars },
    },
    pricing: pricing(hotel, hotel.perNightAmount),
    maxGuests: hotel.maxGuests,
  };
}

export const resolvers = {
  Query: {
    searchHotels: (_parent: unknown, args: { input: SearchInput }) => {
      const { destination, checkIn, checkOut, guests } = args.input;
      nightsBetween(checkIn, checkOut);
      const occupancy = normalizeGuests(guests);

      const edges = searchInventory(destination, occupancy).map((hotel) => ({
        node: toNode(hotel),
      }));
      return { edges, totalCount: edges.length };
    },

    hotelQuote: (_parent: unknown, args: { input: QuoteInput }, context: GammaContext) => {
      const { hotelId, checkIn, checkOut, guests } = args.input;
      const nights = nightsBetween(checkIn, checkOut);
      const occupancy = normalizeGuests(guests);

      const hotel = findHotel(hotelId);
      if (!hotel) {
        throw createGraphQLError("No such hotel", {
          extensions: { code: "HOTEL_NOT_FOUND" },
        });
      }
      if (hotel.maxGuests < occupancy) {
        throw createGraphQLError("Requested guests exceed maxGuests", {
          extensions: { code: "OCCUPANCY_EXCEEDED" },
        });
      }

      // The interesting part: roughly one quote in ten comes back at a price
      // search never advertised. Gamma reports this honestly via priceChanged,
      // but the aggregator must not trust that flag — M5 compares the amounts
      // itself, because a real supplier would not tell you.
      const priceChanged = context.chaos.shouldDrift(context.override);
      const amount = priceChanged
        ? context.chaos.drift(hotel.perNightAmount)
        : hotel.perNightAmount;

      return {
        hotelId: hotel.id,
        property: {
          name: hotel.name,
          city: hotel.city,
          rating: { stars: hotel.stars },
        },
        pricing: pricing(hotel, amount),
        nights,
        priceChanged,
      };
    },
  },
};

export const schema = createSchema<GammaContext>({ typeDefs, resolvers });
