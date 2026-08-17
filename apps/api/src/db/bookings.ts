import {
  applyTransition,
  fromMinor,
  type BookingStatus,
  type BookingTransition,
  type Money,
} from "@stayfinder/shared";
import { createHash } from "node:crypto";
import type { Booking, BookingEvent, Quote } from "../generated/prisma/client";
import type { PrismaClient } from "./client";

/**
 * Booking persistence, including the idempotency and single-use-quote rules.
 *
 * Both of those are enforced by unique constraints rather than by reading first
 * and then deciding. A read-then-write check races: two concurrent requests both
 * see nothing and both insert. The constraint is the guarantee; the read is only
 * a fast path that avoids provoking an error in the common case.
 */

/** Prisma's error code for a unique constraint violation. */
const UNIQUE_VIOLATION = "P2002";

export interface NewBooking {
  quote: Quote;
  idempotencyKey: string;
  guestName: string;
  guestEmail: string;
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

export type BookingWithQuote = Booking & { quote: Quote };

export function toBookingView(booking: BookingWithQuote): BookingView {
  return {
    id: booking.id,
    quoteId: booking.quoteId,
    status: booking.status,
    guestName: booking.guestName,
    guestEmail: booking.guestEmail,
    total: fromMinor(booking.totalMinor, booking.currency),
    hotelName: booking.quote.hotelName,
    city: booking.quote.city,
    checkIn: booking.quote.checkIn,
    checkOut: booking.quote.checkOut,
    nights: booking.quote.nights,
    guests: booking.quote.guests,
    createdAt: booking.createdAt.toISOString(),
    updatedAt: booking.updatedAt.toISOString(),
  };
}

export function toBookingEventView(event: BookingEvent): BookingEventView {
  return {
    from: event.fromStatus,
    to: event.toStatus,
    transition: event.transition,
    at: event.at.toISOString(),
  };
}

/**
 * Fingerprint of the request a key was first used with.
 *
 * Reusing an idempotency key with a *different* payload is a client bug, not a
 * retry, and answering it with the earlier booking would hide the mistake while
 * quietly ignoring what was actually asked for.
 */
export function hashRequest(input: {
  quoteId: string;
  guestName: string;
  guestEmail: string;
}): string {
  return createHash("sha256")
    .update(JSON.stringify([input.quoteId, input.guestName, input.guestEmail]))
    .digest("hex");
}

export class QuoteAlreadyBookedError extends Error {
  constructor() {
    super("This quote has already been booked");
    this.name = "QuoteAlreadyBookedError";
  }
}

export class IdempotencyKeyReusedError extends Error {
  constructor() {
    super("This idempotency key was already used with a different request");
    this.name = "IdempotencyKeyReusedError";
  }
}

export interface CreateResult {
  booking: BookingWithQuote;
  /** False when an existing booking was returned instead of a new one. */
  created: boolean;
}

/**
 * Which column a unique-constraint violation was about.
 *
 * Two shapes have to be read, and getting this wrong is silent: the recovery
 * path simply never runs and a conflict surfaces as a 500.
 *
 * - Prisma 7 with a driver adapter reports the columns at
 *   `meta.driverAdapterError.cause.constraint.fields`, and the names arrive
 *   **quoted** (`"quoteId"`), because they come straight from Postgres.
 * - Older Prisma (and non-adapter setups) use a flat `meta.target`.
 *
 * Exported so the shapes can be asserted directly. A test that only provokes a
 * real conflict can pass for the wrong reason — the pre-flight lookup catches
 * most races before the constraint ever fires.
 */
export function uniqueViolationFields(error: unknown): string[] {
  if (typeof error !== "object" || error === null) return [];

  const candidate = error as {
    code?: unknown;
    meta?: {
      target?: unknown;
      driverAdapterError?: { cause?: { constraint?: { fields?: unknown } } };
    };
  };
  if (candidate.code !== UNIQUE_VIOLATION) return [];

  const unquote = (field: unknown): string => String(field).replace(/^"|"$/g, "");

  const adapterFields = candidate.meta?.driverAdapterError?.cause?.constraint?.fields;
  if (Array.isArray(adapterFields)) return adapterFields.map(unquote);

  const target = candidate.meta?.target;
  if (Array.isArray(target)) return target.map(unquote);
  if (typeof target === "string") return [unquote(target)];

  return [];
}

export class BookingRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async find(id: string): Promise<BookingWithQuote | null> {
    return this.prisma.booking.findUnique({ where: { id }, include: { quote: true } });
  }

  async findByIdempotencyKey(key: string): Promise<BookingWithQuote | null> {
    return this.prisma.booking.findUnique({
      where: { idempotencyKey: key },
      include: { quote: true },
    });
  }

  async events(bookingId: string): Promise<BookingEvent[]> {
    return this.prisma.bookingEvent.findMany({
      where: { bookingId },
      orderBy: { at: "asc" },
    });
  }

  /**
   * Create a PENDING booking, or return the one this key already made.
   *
   * The happy path is a single insert. Everything else is recovery from a
   * constraint the database enforced.
   */
  async create(input: NewBooking): Promise<CreateResult> {
    const requestHash = hashRequest({
      quoteId: input.quote.id,
      guestName: input.guestName,
      guestEmail: input.guestEmail,
    });

    const existing = await this.findByIdempotencyKey(input.idempotencyKey);
    if (existing !== null) {
      return { booking: this.assertSameRequest(existing, requestHash), created: false };
    }

    try {
      // The booking and its first event are written together: a booking with no
      // history would be a timeline missing its own beginning.
      const booking = await this.prisma.$transaction(async (tx) => {
        const created = await tx.booking.create({
          data: {
            quoteId: input.quote.id,
            status: "PENDING",
            idempotencyKey: input.idempotencyKey,
            requestHash,
            guestName: input.guestName,
            guestEmail: input.guestEmail,
            totalMinor: input.quote.totalMinor,
            currency: input.quote.currency,
          },
          include: { quote: true },
        });

        await tx.bookingEvent.create({
          data: { bookingId: created.id, fromStatus: null, toStatus: "PENDING", transition: null },
        });

        return created;
      });

      return { booking, created: true };
    } catch (error) {
      const violated = uniqueViolationFields(error);
      if (violated.length === 0) throw error;

      // Lost the race. Which constraint gets reported is not something we can
      // rely on: a replayed request violates *both* `idempotencyKey` and
      // `quoteId`, and Postgres names whichever index it happened to check
      // first. Branching on the reported column therefore answers the wrong
      // question — a concurrent double-click would be told the quote was taken
      // instead of being handed the booking it had already made.
      //
      // So always ask the question that actually matters first: did this key
      // already produce a booking?
      const winner = await this.findByIdempotencyKey(input.idempotencyKey);
      if (winner !== null) {
        return { booking: this.assertSameRequest(winner, requestHash), created: false };
      }

      // No booking for this key, so the collision was somebody else's booking of
      // the same quote.
      if (violated.includes("quoteId")) {
        throw new QuoteAlreadyBookedError();
      }
      throw error;
    }
  }

  private assertSameRequest(booking: BookingWithQuote, requestHash: string): BookingWithQuote {
    if (booking.requestHash !== requestHash) {
      throw new IdempotencyKeyReusedError();
    }
    return booking;
  }

  /**
   * Move a booking through the state machine and record the event.
   *
   * The machine decides legality — this method only persists. `applyTransition`
   * throws on anything illegal, and doing that before the write means an invalid
   * state can never reach the database at all.
   */
  async transition(bookingId: string, transition: BookingTransition): Promise<BookingWithQuote> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.booking.findUniqueOrThrow({ where: { id: bookingId } });
      const next = applyTransition(current.status, transition);

      const updated = await tx.booking.update({
        where: { id: bookingId },
        data: { status: next },
        include: { quote: true },
      });

      await tx.bookingEvent.create({
        data: {
          bookingId,
          fromStatus: current.status,
          toStatus: next,
          transition,
        },
      });

      return updated;
    });
  }
}
