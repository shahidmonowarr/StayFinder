"use client";

import type { BookingStatus, Money } from "@stayfinder/shared";

/**
 * Client bindings for the quote and booking endpoints.
 *
 * Deliberately thin: no caching, no retry, no state library. The interesting
 * behaviour in this flow lives on the server, and a client that quietly retried
 * a booking would be actively harmful — that is precisely what the idempotency
 * key exists to make safe, and hiding it here would obscure the mechanism.
 */

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

export interface QuoteResult {
  status: "OK" | "PRICE_CHANGED";
  quote: QuoteView;
  previousTotal?: Money;
}

export interface BookingView {
  id: string;
  quoteId: string;
  status: BookingStatus;
  guestName: string;
  guestEmail: string;
  total: Money;
  hotelName: string;
  city: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  guests: number;
  createdAt: string;
  updatedAt: string;
}

export interface BookingEventView {
  from: BookingStatus | null;
  to: BookingStatus;
  transition: string | null;
  at: string;
}

/** An error the API described, as opposed to a network failure. */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function readError(response: Response): Promise<never> {
  let code = "UNKNOWN";
  let message = `Request failed with ${response.status}`;
  try {
    const body = (await response.json()) as { error?: string; message?: string };
    if (typeof body.error === "string") code = body.error;
    if (typeof body.message === "string") message = body.message;
  } catch {
    // A body we cannot parse is still a failure we can report honestly.
  }
  throw new ApiError(response.status, code, message);
}

export async function requestQuote(
  baseUrl: string,
  input: {
    optionId: string;
    checkIn: string;
    checkOut: string;
    guests: number;
    searchedTotalMinor: number;
  },
): Promise<QuoteResult> {
  const response = await fetch(`${baseUrl}/api/quote`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) await readError(response);
  return (await response.json()) as QuoteResult;
}

export async function createBooking(
  baseUrl: string,
  input: { quoteId: string; guestName: string; guestEmail: string },
  idempotencyKey: string,
): Promise<{ booking: BookingView; created: boolean }> {
  const response = await fetch(`${baseUrl}/api/bookings`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // Generated once per attempt by the caller and reused across retries of
      // *that* attempt, so a double-click cannot become two bookings.
      "idempotency-key": idempotencyKey,
    },
    body: JSON.stringify(input),
  });
  if (!response.ok) await readError(response);
  return (await response.json()) as { booking: BookingView; created: boolean };
}

export async function fetchBooking(
  baseUrl: string,
  id: string,
): Promise<{ booking: BookingView; events: BookingEventView[] }> {
  const response = await fetch(`${baseUrl}/api/bookings/${id}`);
  if (!response.ok) await readError(response);
  return (await response.json()) as { booking: BookingView; events: BookingEventView[] };
}
