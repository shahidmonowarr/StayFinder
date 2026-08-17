import { fromMinor, type Money } from "@stayfinder/shared";
import type { Quote } from "../generated/prisma/client";
import type { PrismaClient } from "./client";

/**
 * Quote persistence.
 *
 * A repository rather than Prisma calls in route handlers: the interesting rules
 * (a quote expires, a quote is single-use) belong somewhere they can be stated
 * once and tested, and the routes should read as policy rather than SQL.
 */

/** How long a quoted price is honoured. */
export const QUOTE_TTL_MS = 5 * 60 * 1000;

export interface NewQuote {
  supplier: string;
  supplierHotelId: string;
  hotelName: string;
  city: string;
  starRating: number;
  checkIn: string;
  checkOut: string;
  nights: number;
  guests: number;
  nightlyRate: Money;
  totalPrice: Money;
  refundable: boolean;
  searchedTotalMinor: number | null;
  priceChanged: boolean;
}

/** The API-facing view. Money is reassembled; minor units never leak as bare ints. */
export interface QuoteView {
  id: string;
  supplier: string;
  supplierHotelId: string;
  hotelName: string;
  city: string;
  starRating: number;
  checkIn: string;
  checkOut: string;
  nights: number;
  guests: number;
  nightlyRate: Money;
  totalPrice: Money;
  refundable: boolean;
  priceChanged: boolean;
  expiresAt: string;
}

export function toQuoteView(quote: Quote): QuoteView {
  return {
    id: quote.id,
    supplier: quote.supplier,
    supplierHotelId: quote.supplierHotelId,
    hotelName: quote.hotelName,
    city: quote.city,
    starRating: quote.starRating,
    checkIn: quote.checkIn,
    checkOut: quote.checkOut,
    nights: quote.nights,
    guests: quote.guests,
    nightlyRate: fromMinor(quote.nightlyRateMinor, quote.currency),
    totalPrice: fromMinor(quote.totalMinor, quote.currency),
    refundable: quote.refundable,
    priceChanged: quote.priceChanged,
    expiresAt: quote.expiresAt.toISOString(),
  };
}

export class QuoteRepository {
  constructor(
    private readonly prisma: PrismaClient,
    /** Injectable clock, so expiry can be tested without waiting five minutes. */
    private readonly now: () => Date = () => new Date(),
  ) {}

  async create(quote: NewQuote): Promise<Quote> {
    return this.prisma.quote.create({
      data: {
        supplier: quote.supplier,
        supplierHotelId: quote.supplierHotelId,
        hotelName: quote.hotelName,
        city: quote.city,
        starRating: quote.starRating,
        checkIn: quote.checkIn,
        checkOut: quote.checkOut,
        nights: quote.nights,
        guests: quote.guests,
        nightlyRateMinor: quote.nightlyRate.amountMinor,
        totalMinor: quote.totalPrice.amountMinor,
        currency: quote.totalPrice.currency,
        refundable: quote.refundable,
        searchedTotalMinor: quote.searchedTotalMinor,
        priceChanged: quote.priceChanged,
        expiresAt: new Date(this.now().getTime() + QUOTE_TTL_MS),
      },
    });
  }

  async find(id: string): Promise<Quote | null> {
    return this.prisma.quote.findUnique({ where: { id } });
  }

  isExpired(quote: Quote): boolean {
    return quote.expiresAt.getTime() <= this.now().getTime();
  }
}
