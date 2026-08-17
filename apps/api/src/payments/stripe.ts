import type Stripe from "stripe";
import {
  WebhookSignatureError,
  type PaymentEvent,
  type PaymentIntent,
  type PaymentProvider,
  type RefundResult,
} from "./types";

/**
 * The real provider, in Stripe test mode.
 *
 * ⚠️ **Unverified.** Every other file in this milestone has been exercised
 * end to end against the fake provider; this one has not, because doing so needs
 * a Stripe account and API keys. It is written to the same port and the shape is
 * straightforward, but "compiles and looks right" is not "works", and it would
 * be dishonest to present it otherwise.
 *
 * To verify it:
 *
 * ```bash
 * # in .env — never committed
 * STRIPE_SECRET_KEY=sk_test_...
 * STRIPE_WEBHOOK_SECRET=whsec_...        # printed by the command below
 *
 * stripe listen --forward-to localhost:4000/api/webhooks/stripe
 * ```
 *
 * The API switches to this provider automatically once `STRIPE_SECRET_KEY` is
 * set, and the dev delivery route disappears — with a real provider, real
 * deliveries are the only ones.
 */
export class StripePaymentProvider implements PaymentProvider {
  readonly kind = "stripe" as const;

  constructor(
    private readonly stripe: Stripe,
    private readonly webhookSecret: string,
  ) {}

  async createPaymentIntent(input: {
    bookingId: string;
    amountMinor: number;
    currency: string;
    idempotencyKey: string;
  }): Promise<PaymentIntent> {
    const intent = await this.stripe.paymentIntents.create(
      {
        amount: input.amountMinor,
        currency: input.currency.toLowerCase(),
        // Carried through onto the event, so a webhook can be traced back to a
        // booking even if our own row were somehow missing.
        metadata: { bookingId: input.bookingId },
        automatic_payment_methods: { enabled: true },
      },
      // Stripe's own idempotency, on top of ours: a retried create returns the
      // original intent rather than a second one to charge.
      { idempotencyKey: input.idempotencyKey },
    );

    if (intent.client_secret === null) {
      throw new Error("Stripe returned a payment intent with no client secret");
    }

    return {
      id: intent.id,
      clientSecret: intent.client_secret,
      amountMinor: intent.amount,
      currency: intent.currency.toUpperCase(),
    };
  }

  async refund(input: {
    paymentIntentId: string;
    amountMinor: number;
    idempotencyKey: string;
  }): Promise<RefundResult> {
    const refund = await this.stripe.refunds.create(
      { payment_intent: input.paymentIntentId, amount: input.amountMinor },
      { idempotencyKey: input.idempotencyKey },
    );

    return { id: refund.id, amountMinor: refund.amount };
  }

  verifyWebhook(rawBody: Buffer, signature: string | undefined): PaymentEvent | null {
    if (signature === undefined || signature === "") {
      throw new WebhookSignatureError("Missing Stripe-Signature header");
    }

    let event: Stripe.Event;
    try {
      // Stripe's own verification, including the timestamp tolerance. It needs
      // the raw bytes for the same reason the fake does.
      event = this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
    } catch (error) {
      throw new WebhookSignatureError(
        error instanceof Error ? error.message : "Signature verification failed",
      );
    }

    return normalizeStripeEvent(event);
  }
}

/**
 * Map a Stripe event onto the three this system acts on.
 *
 * Split out and exported so the mapping — the part with actual decisions in it —
 * can be tested against captured Stripe payloads without a live account.
 */
export function normalizeStripeEvent(event: Stripe.Event): PaymentEvent | null {
  switch (event.type) {
    case "payment_intent.succeeded": {
      const intent = event.data.object;
      return {
        id: event.id,
        kind: "payment_succeeded",
        paymentIntentId: intent.id,
        amountMinor: intent.amount_received > 0 ? intent.amount_received : intent.amount,
        currency: intent.currency.toUpperCase(),
        rawType: event.type,
      };
    }

    case "payment_intent.payment_failed": {
      const intent = event.data.object;
      return {
        id: event.id,
        kind: "payment_failed",
        paymentIntentId: intent.id,
        amountMinor: intent.amount,
        currency: intent.currency.toUpperCase(),
        rawType: event.type,
      };
    }

    case "charge.refunded": {
      const charge = event.data.object;
      const paymentIntentId =
        typeof charge.payment_intent === "string"
          ? charge.payment_intent
          : (charge.payment_intent?.id ?? "");
      const latestRefund = charge.refunds?.data[0];

      return {
        id: event.id,
        kind: "refund_succeeded",
        paymentIntentId,
        // `amount_refunded` is cumulative across partial refunds; the individual
        // refund's amount is what belongs on a ledger row.
        amountMinor: latestRefund?.amount ?? charge.amount_refunded,
        currency: charge.currency.toUpperCase(),
        ...(latestRefund === undefined ? {} : { refundId: latestRefund.id }),
        rawType: event.type,
      };
    }

    default:
      // Signed and genuine, but not something we act on.
      return null;
  }
}
