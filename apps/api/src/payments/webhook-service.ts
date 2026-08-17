import { applyTransition, canTransition, type BookingTransition } from "@stayfinder/shared";
import type { PrismaClient } from "../db/client";
import { uniqueViolationFields } from "../db/prisma-errors";
import { WebhookSignatureError, type PaymentEvent, type PaymentProvider } from "./types";

/**
 * Webhook processing, kept out of Express so it can be driven directly.
 *
 * The rules here are the whole point of the milestone:
 *
 * 1. Nothing is trusted before the signature is checked.
 * 2. A delivery we have already processed does nothing the second time.
 * 3. A transition the state machine forbids is a considered no-op, not an error.
 * 4. Every write for one delivery happens in one transaction, including the
 *    record that we saw it.
 */

export type WebhookOutcome =
  "processed" | "duplicate" | "ignored_event_type" | "unknown_booking" | "already_in_state";

export interface WebhookResult {
  outcome: WebhookOutcome;
  eventId?: string;
}

export interface WebhookDependencies {
  prisma: PrismaClient;
  provider: PaymentProvider;
}

const TRANSITION_FOR: Record<PaymentEvent["kind"], BookingTransition> = {
  payment_succeeded: "confirm",
  payment_failed: "fail",
  refund_succeeded: "refund",
};

export async function handleWebhookDelivery(
  deps: WebhookDependencies,
  rawBody: Buffer,
  signature: string | undefined,
): Promise<WebhookResult> {
  // Throws WebhookSignatureError, which the route turns into a 400. Nothing
  // below this line runs on an unverified payload.
  const event = deps.provider.verifyWebhook(rawBody, signature);

  if (event === null) {
    // Genuine but not something we act on. Acknowledged so the provider stops
    // retrying — a 4xx here would have Stripe redelivering an event forever.
    return { outcome: "ignored_event_type" };
  }

  try {
    return await deps.prisma.$transaction(async (tx) => {
      // Recorded *inside* the transaction, deliberately. If the work below fails
      // and rolls back, this row goes with it, so the provider's retry gets a
      // real second attempt. Recording it outside would mark a failed delivery
      // as handled and lose the booking's confirmation permanently.
      await tx.webhookEvent.create({ data: { id: event.id, type: event.rawType } });

      const booking = await tx.booking.findUnique({
        where: { paymentIntentId: event.paymentIntentId },
      });

      if (booking === null) {
        // Acknowledged, not retried: no amount of redelivery will make a booking
        // we have never heard of appear.
        return { outcome: "unknown_booking" as const, eventId: event.id };
      }

      const transition = TRANSITION_FOR[event.kind];

      if (!canTransition(booking.status, transition)) {
        // The considered no-op. A second `succeeded` for an already-CONFIRMED
        // booking lands here — checked, not caught. Catching an exception
        // instead would make a genuine double-confirm indistinguishable from a
        // harmless retry, which is exactly the signal worth keeping.
        return { outcome: "already_in_state" as const, eventId: event.id };
      }

      // Safe: `canTransition` was checked immediately above.
      const next = applyTransition(booking.status, transition);

      await tx.booking.update({ where: { id: booking.id }, data: { status: next } });
      await tx.bookingEvent.create({
        data: {
          bookingId: booking.id,
          fromStatus: booking.status,
          toStatus: next,
          transition,
        },
      });

      // Money moved, so the ledger gets a row. A failed payment moves nothing.
      if (event.kind === "payment_succeeded") {
        await tx.transaction.create({
          data: {
            bookingId: booking.id,
            kind: "CHARGE",
            amountMinor: event.amountMinor,
            currency: event.currency,
            providerRef: event.paymentIntentId,
          },
        });
      }
      if (event.kind === "refund_succeeded") {
        await tx.transaction.create({
          data: {
            bookingId: booking.id,
            kind: "REFUND",
            amountMinor: event.amountMinor,
            currency: event.currency,
            providerRef: event.refundId ?? event.paymentIntentId,
          },
        });
      }

      return { outcome: "processed" as const, eventId: event.id };
    });
  } catch (error) {
    // The primary key on the event id did its job. Note the M5 lesson applies:
    // the question is "have I already processed this event?", not "which index
    // complained?" — so this checks for any unique violation and then answers
    // the question it actually cares about.
    if (uniqueViolationFields(error).length > 0) {
      return { outcome: "duplicate", eventId: event.id };
    }
    throw error;
  }
}

export { WebhookSignatureError };
