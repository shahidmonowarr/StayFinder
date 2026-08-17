import type { Request, RequestHandler, Response } from "express";
import { z } from "zod";
import {
  IdempotencyKeyReusedError,
  QuoteAlreadyBookedError,
  toBookingEventView,
  toBookingView,
  type BookingRepository,
} from "../db/bookings";
import type { QuoteRepository } from "../db/quotes";

/**
 * Booking creation and retrieval.
 *
 * Bookings stop at PENDING here — nothing charges a card until M6. What this
 * milestone establishes is that a booking can only come from a quote the server
 * issued, that the quote must still be valid, and that replaying the request
 * cannot produce a second booking.
 */

export const CreateBookingSchema = z.object({
  quoteId: z.string().min(1),
  guestName: z.string().trim().min(1, "is required").max(120),
  guestEmail: z.string().trim().email("must be a valid email address"),
});

export interface BookingRouteOptions {
  quotes: QuoteRepository;
  bookings: BookingRepository;
}

export function createBookingHandler(options: BookingRouteOptions): RequestHandler {
  return async (req: Request, res: Response) => {
    // The key is a header rather than a body field: it describes the *request*,
    // not the booking, and a retry must be able to reuse it without the payload
    // looking different.
    const idempotencyKey = req.header("idempotency-key");
    if (idempotencyKey === undefined || idempotencyKey.trim() === "") {
      res.status(400).json({
        error: "IDEMPOTENCY_KEY_REQUIRED",
        message: "Send an Idempotency-Key header so a retry cannot double-book",
      });
      return;
    }

    const parsed = CreateBookingSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "INVALID_REQUEST",
        issues: parsed.error.issues.map((issue) => ({
          field: issue.path.join(".") || "request",
          message: issue.message,
        })),
      });
      return;
    }

    const quote = await options.quotes.find(parsed.data.quoteId);
    if (quote === null) {
      res.status(404).json({ error: "QUOTE_NOT_FOUND" });
      return;
    }
    if (options.quotes.isExpired(quote)) {
      // Not a silent re-quote: the user agreed to a specific number, and
      // substituting a fresh one is exactly what the PRICE_CHANGED flow exists
      // to prevent.
      res.status(409).json({
        error: "QUOTE_EXPIRED",
        expiredAt: quote.expiresAt.toISOString(),
        message: "Request a new quote before booking",
      });
      return;
    }

    try {
      const { booking, created } = await options.bookings.create({
        quote,
        idempotencyKey: idempotencyKey.trim(),
        guestName: parsed.data.guestName,
        guestEmail: parsed.data.guestEmail,
      });

      // 201 for a new booking, 200 for a replay. The client can tell the
      // difference, which matters if it is counting on having created something.
      res.status(created ? 201 : 200).json({ booking: toBookingView(booking), created });
    } catch (error) {
      if (error instanceof QuoteAlreadyBookedError) {
        res.status(409).json({ error: "QUOTE_ALREADY_BOOKED", message: error.message });
        return;
      }
      if (error instanceof IdempotencyKeyReusedError) {
        res.status(409).json({ error: "IDEMPOTENCY_KEY_REUSED", message: error.message });
        return;
      }
      throw error;
    }
  };
}

export function createGetBookingHandler(options: BookingRouteOptions): RequestHandler {
  return async (req: Request, res: Response) => {
    const id = String(req.params.id ?? "");
    const booking = await options.bookings.find(id);
    if (booking === null) {
      res.status(404).json({ error: "BOOKING_NOT_FOUND" });
      return;
    }

    const events = await options.bookings.events(id);
    res.json({
      booking: toBookingView(booking),
      // The append-only history, oldest first — this is the state timeline the
      // confirmation page renders.
      events: events.map(toBookingEventView),
    });
  };
}
