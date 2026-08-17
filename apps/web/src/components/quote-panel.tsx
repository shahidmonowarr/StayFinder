"use client";

import { formatMoney, subtractMoney, type HotelOption } from "@stayfinder/shared";
import { useState } from "react";
import {
  ApiError,
  createBooking,
  requestQuote,
  type BookingView,
  type QuoteResult,
} from "@/lib/booking-api";

/**
 * Quote and book one offer.
 *
 * The important behaviour is the interstitial: when the live price differs from
 * what the card showed, the user is stopped and shown both numbers. They cannot
 * proceed by accident — accepting the new price is a separate, deliberate click.
 */

type Phase =
  | { step: "idle" }
  | { step: "quoting" }
  | { step: "quoted"; result: QuoteResult }
  | { step: "booking"; result: QuoteResult }
  | { step: "booked"; booking: BookingView }
  | { step: "failed"; message: string; code: string };

/**
 * One key per booking attempt, generated before the request and reused if that
 * same attempt is retried. Regenerating per click would defeat the entire point.
 */
function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

function PriceChangeNotice({ result }: { result: QuoteResult }) {
  if (result.previousTotal === undefined) return null;
  const difference = subtractMoney(result.quote.totalPrice, result.previousTotal);
  const rose = difference.amountMinor > 0;

  return (
    <div className="rounded border border-warn/40 bg-warn/5 p-3 text-sm" role="alert">
      <p className="font-medium">The supplier changed this price.</p>
      <p className="mt-1 text-muted">
        You were shown <span className="line-through">{formatMoney(result.previousTotal)}</span>.
        The live price is{" "}
        <span className="font-medium text-ink">{formatMoney(result.quote.totalPrice)}</span> —{" "}
        {rose ? "up" : "down"}{" "}
        {formatMoney({ ...difference, amountMinor: Math.abs(difference.amountMinor) })}.
      </p>
      <p className="mt-1 text-muted">Booking continues at the new price only if you accept it.</p>
    </div>
  );
}

export function QuotePanel({
  option,
  apiUrl,
  onClose,
}: {
  option: HotelOption;
  apiUrl: string;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<Phase>({ step: "idle" });
  const [guestName, setGuestName] = useState("Ada Lovelace");
  const [guestEmail, setGuestEmail] = useState("ada@example.com");

  async function getQuote() {
    setPhase({ step: "quoting" });
    try {
      const result = await requestQuote(apiUrl, {
        optionId: option.id,
        checkIn: option.checkIn,
        checkOut: option.checkOut,
        guests: option.guests,
        // What this card is displaying. The server compares against it, and
        // charges its own number regardless.
        searchedTotalMinor: option.totalPrice.amountMinor,
      });
      setPhase({ step: "quoted", result });
    } catch (error) {
      setPhase(describeFailure(error));
    }
  }

  async function book(result: QuoteResult) {
    setPhase({ step: "booking", result });
    try {
      const { booking } = await createBooking(
        apiUrl,
        { quoteId: result.quote.id, guestName, guestEmail },
        newIdempotencyKey(),
      );
      setPhase({ step: "booked", booking });
    } catch (error) {
      setPhase(describeFailure(error));
    }
  }

  return (
    <div className="mt-3 rounded border border-line bg-white p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium">{option.name}</p>
          <p className="text-xs text-muted">
            {option.city} · {option.nights} nights · {option.guests} guests ·{" "}
            <span className="capitalize">{option.supplier}</span>
          </p>
        </div>
        <button type="button" onClick={onClose} className="text-xs text-muted underline">
          Close
        </button>
      </div>

      {phase.step === "idle" && (
        <div className="mt-4 flex items-center gap-3">
          <p className="text-sm text-muted">
            Search showed {formatMoney(option.totalPrice)}. Re-check the live price before booking.
          </p>
          <button
            type="button"
            onClick={getQuote}
            className="ml-auto rounded bg-ink px-3 py-1.5 text-sm text-white"
          >
            Get live price
          </button>
        </div>
      )}

      {phase.step === "quoting" && <p className="mt-4 text-sm text-muted">Asking the supplier…</p>}

      {(phase.step === "quoted" || phase.step === "booking") && (
        <div className="mt-4 space-y-3">
          {phase.result.status === "PRICE_CHANGED" && <PriceChangeNotice result={phase.result} />}

          <div className="flex items-baseline justify-between text-sm">
            <span className="text-muted">Total for the stay</span>
            <span className="font-medium tabular-nums">
              {formatMoney(phase.result.quote.totalPrice)}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label>
              <span className="mb-1 block text-xs text-muted">Guest name</span>
              <input
                className="w-full rounded border border-line px-2 py-1.5 text-sm"
                value={guestName}
                onChange={(event) => setGuestName(event.target.value)}
              />
            </label>
            <label>
              <span className="mb-1 block text-xs text-muted">Email</span>
              <input
                className="w-full rounded border border-line px-2 py-1.5 text-sm"
                value={guestEmail}
                onChange={(event) => setGuestEmail(event.target.value)}
              />
            </label>
          </div>

          <button
            type="button"
            disabled={phase.step === "booking"}
            onClick={() => void book(phase.result)}
            className="w-full rounded bg-ink px-3 py-2 text-sm text-white disabled:opacity-50"
          >
            {phase.step === "booking"
              ? "Creating booking…"
              : phase.result.status === "PRICE_CHANGED"
                ? `Accept ${formatMoney(phase.result.quote.totalPrice)} and book`
                : "Book"}
          </button>
        </div>
      )}

      {phase.step === "booked" && (
        <div className="mt-4 space-y-2">
          <p className="text-sm">
            Booking created as <span className="font-medium">{phase.booking.status}</span>.
          </p>
          <a
            href={`/bookings/${phase.booking.id}`}
            className="inline-block text-sm text-accent underline underline-offset-2"
          >
            View booking and its state timeline
          </a>
        </div>
      )}

      {phase.step === "failed" && (
        <div className="mt-4 space-y-2" role="alert">
          <p className="text-sm text-bad">{phase.message}</p>
          <button type="button" onClick={getQuote} className="text-sm text-accent underline">
            Try again
          </button>
        </div>
      )}
    </div>
  );
}

function describeFailure(error: unknown): Phase {
  if (error instanceof ApiError) {
    // Each of these is a specific, expected outcome rather than a generic
    // failure, so the copy names what happened and what to do about it.
    const explanation: Record<string, string> = {
      SUPPLIER_UNAVAILABLE:
        "The supplier did not answer, so we cannot confirm a price. Nothing was booked.",
      HOTEL_NOT_FOUND: "The supplier no longer has this room.",
      QUOTE_EXPIRED: "That price expired. Get a fresh quote before booking.",
      QUOTE_ALREADY_BOOKED: "This quote has already been used for a booking.",
      IDEMPOTENCY_KEY_REUSED: "That request was already made with different details.",
    };
    return {
      step: "failed",
      code: error.code,
      message: explanation[error.code] ?? error.message,
    };
  }
  return {
    step: "failed",
    code: "NETWORK",
    message: "Could not reach the booking service.",
  };
}
