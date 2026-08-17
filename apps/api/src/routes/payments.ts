import { canTransition, isPaid, legalTransitions } from "@stayfinder/shared";
import type { Request, RequestHandler, Response } from "express";
import { toBookingView, type BookingRepository } from "../db/bookings";
import type { PrismaClient } from "../db/client";
import { describeError } from "../errors";
import { signPayload, type FakeEventPayload } from "../payments/fake";
import type { PaymentProvider } from "../payments/types";
import { handleWebhookDelivery, WebhookSignatureError } from "../payments/webhook-service";

export interface PaymentRouteOptions {
  prisma: PrismaClient;
  bookings: BookingRepository;
  provider: PaymentProvider;
  /** Only used by the fake-provider dev route, to sign its own deliveries. */
  webhookSecret: string;
}

/**
 * Start checkout for a booking.
 *
 * Nothing here confirms anything. It creates an intent, records its id on the
 * booking so a webhook can be matched back, and hands the client secret to the
 * browser. Confirmation arrives later, over the webhook, or not at all.
 */
export function createPaymentIntentHandler(options: PaymentRouteOptions): RequestHandler {
  return async (req: Request, res: Response) => {
    const booking = await options.bookings.find(String(req.params.id ?? ""));
    if (booking === null) {
      res.status(404).json({ error: "BOOKING_NOT_FOUND" });
      return;
    }

    if (!canTransition(booking.status, "confirm")) {
      res.status(409).json({
        error: "ILLEGAL_TRANSITION",
        status: booking.status,
        allowed: legalTransitions(booking.status),
        message: `A booking in state ${booking.status} cannot be paid for`,
      });
      return;
    }

    const intent = await options.provider.createPaymentIntent({
      bookingId: booking.id,
      amountMinor: booking.totalMinor,
      currency: booking.currency,
      // Derived from the booking, so a double-clicked checkout asks the provider
      // for the same intent rather than creating a second one to charge.
      idempotencyKey: `pi-${booking.id}`,
    });

    await options.prisma.booking.update({
      where: { id: booking.id },
      data: { paymentIntentId: intent.id },
    });

    res.json({
      paymentIntentId: intent.id,
      clientSecret: intent.clientSecret,
      amountMinor: intent.amountMinor,
      currency: intent.currency,
      provider: options.provider.kind,
    });
  };
}

/**
 * The webhook endpoint.
 *
 * Mounted with `express.raw`, not `express.json` — the signature covers the
 * exact bytes sent, and a body that has been parsed and re-serialized will not
 * match. That failure only shows up against the real provider, which is what
 * makes it worth being explicit about.
 */
export function createWebhookHandler(options: PaymentRouteOptions): RequestHandler {
  return async (req: Request, res: Response) => {
    const signature = req.header("stripe-signature") ?? req.header("x-payment-signature");
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body ?? ""));

    try {
      const result = await handleWebhookDelivery(
        { prisma: options.prisma, provider: options.provider },
        rawBody,
        signature,
      );
      // Always 200 once the signature checks out. A non-2xx tells the provider
      // to redeliver, and every outcome here — duplicate, unknown booking,
      // uninteresting type — is one that redelivery cannot improve.
      res.json({ received: true, ...result });
    } catch (error) {
      if (error instanceof WebhookSignatureError) {
        res.status(400).json({ error: "INVALID_SIGNATURE", message: error.message });
        return;
      }
      // A genuine failure *should* be retried, so this one is a 500 on purpose.
      res.status(500).json({ error: "WEBHOOK_PROCESSING_FAILED", message: describeError(error) });
    }
  };
}

/**
 * Cancel a booking, refunding it if it was paid for.
 *
 * The refund is only *requested* here. `CANCELLED → REFUNDED` happens when the
 * refund webhook arrives, which is why CANCELLED is a real waiting state rather
 * than a moment in passing.
 */
export function createCancelHandler(options: PaymentRouteOptions): RequestHandler {
  return async (req: Request, res: Response) => {
    const booking = await options.bookings.find(String(req.params.id ?? ""));
    if (booking === null) {
      res.status(404).json({ error: "BOOKING_NOT_FOUND" });
      return;
    }

    if (!canTransition(booking.status, "cancel")) {
      res.status(409).json({
        error: "ILLEGAL_TRANSITION",
        status: booking.status,
        allowed: legalTransitions(booking.status),
        message: `A booking in state ${booking.status} cannot be cancelled`,
      });
      return;
    }

    // Checked before the transition: afterwards the booking is CANCELLED, and
    // CANCELLED is "paid" too — it means cancelled but not yet refunded.
    const wasPaid = isPaid(booking.status);
    const updated = await options.bookings.transition(booking.id, "cancel");

    if (wasPaid && booking.paymentIntentId !== null) {
      await options.provider.refund({
        paymentIntentId: booking.paymentIntentId,
        amountMinor: booking.totalMinor,
        idempotencyKey: `re-${booking.id}`,
      });
    }

    res.json({
      booking: toBookingView(updated),
      refundRequested: wasPaid,
    });
  };
}

/**
 * Deliver a signed payment event to ourselves. Fake provider only.
 *
 * This exists because something has to play the part of the provider calling
 * back, and a background timer pretending to be a webhook would bypass the
 * signature check and the endpoint — the two things worth demonstrating. Instead
 * this signs a real payload and sends it through the real handler.
 *
 * It is also what M7's chaos toggle will call to deliver the same event twice.
 */
export function createDevEventHandler(options: PaymentRouteOptions): RequestHandler {
  return async (req: Request, res: Response) => {
    const body = req.body as {
      bookingId?: string;
      type?: string;
      eventId?: string;
      amountMinor?: number;
    };

    if (typeof body.bookingId !== "string" || typeof body.type !== "string") {
      res
        .status(400)
        .json({ error: "INVALID_REQUEST", message: "bookingId and type are required" });
      return;
    }

    const booking = await options.bookings.find(body.bookingId);
    if (booking === null) {
      res.status(404).json({ error: "BOOKING_NOT_FOUND" });
      return;
    }
    if (booking.paymentIntentId === null) {
      res.status(409).json({
        error: "NO_PAYMENT_INTENT",
        message: "Start checkout before delivering a payment event",
      });
      return;
    }

    const payload: FakeEventPayload = {
      id: body.eventId ?? `evt_${crypto.randomUUID()}`,
      type: body.type,
      data: {
        paymentIntentId: booking.paymentIntentId,
        amountMinor: body.amountMinor ?? booking.totalMinor,
        currency: booking.currency,
        refundId: `re-${booking.id}`,
      },
    };

    const raw = Buffer.from(JSON.stringify(payload), "utf8");
    const signature = signPayload(
      options.webhookSecret,
      raw.toString("utf8"),
      Math.floor(Date.now() / 1000),
    );

    const result = await handleWebhookDelivery(
      { prisma: options.prisma, provider: options.provider },
      raw,
      signature,
    );

    res.json({ delivered: payload.id, ...result });
  };
}
