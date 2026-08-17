import type Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { normalizeStripeEvent } from "./stripe";

/**
 * The Stripe adapter's network calls cannot be verified without an account, but
 * its *mapping* can — and that is where the decisions are. These fixtures follow
 * the documented shapes of the three events this system acts on.
 *
 * What this does not cover: that `paymentIntents.create` and
 * `webhooks.constructEvent` behave as expected against the live API. That gap is
 * named in `stripe.ts` and closes when real test keys are added.
 */

function event(type: string, object: unknown, id = "evt_test_1"): Stripe.Event {
  return { id, type, data: { object } } as unknown as Stripe.Event;
}

describe("payment_intent.succeeded", () => {
  it("maps to a confirmation with the amount actually received", () => {
    const mapped = normalizeStripeEvent(
      event("payment_intent.succeeded", {
        id: "pi_123",
        amount: 38970,
        amount_received: 38970,
        currency: "eur",
      }),
    );

    expect(mapped).toEqual({
      id: "evt_test_1",
      kind: "payment_succeeded",
      paymentIntentId: "pi_123",
      amountMinor: 38970,
      currency: "EUR",
      rawType: "payment_intent.succeeded",
    });
  });

  it("falls back to the intent amount when nothing was recorded as received", () => {
    const mapped = normalizeStripeEvent(
      event("payment_intent.succeeded", {
        id: "pi_123",
        amount: 38970,
        amount_received: 0,
        currency: "eur",
      }),
    );

    expect(mapped?.amountMinor).toBe(38970);
  });

  it("upper-cases the currency, since Stripe sends it lower and Money expects ISO", () => {
    const mapped = normalizeStripeEvent(
      event("payment_intent.succeeded", {
        id: "pi_1",
        amount: 100,
        amount_received: 100,
        currency: "usd",
      }),
    );

    expect(mapped?.currency).toBe("USD");
  });
});

describe("payment_intent.payment_failed", () => {
  it("maps to a failure", () => {
    const mapped = normalizeStripeEvent(
      event("payment_intent.payment_failed", { id: "pi_9", amount: 500, currency: "eur" }),
    );

    expect(mapped?.kind).toBe("payment_failed");
    expect(mapped?.paymentIntentId).toBe("pi_9");
  });
});

describe("charge.refunded", () => {
  it("uses the individual refund's amount, not the cumulative total", () => {
    // `amount_refunded` accumulates across partial refunds. Putting that on a
    // ledger row would double-count the moment a second partial refund lands.
    const mapped = normalizeStripeEvent(
      event("charge.refunded", {
        payment_intent: "pi_123",
        amount_refunded: 30000,
        currency: "eur",
        refunds: { data: [{ id: "re_second", amount: 10000 }] },
      }),
    );

    expect(mapped?.amountMinor).toBe(10000);
    expect(mapped?.refundId).toBe("re_second");
  });

  it("falls back to the cumulative amount when no refund object is expanded", () => {
    const mapped = normalizeStripeEvent(
      event("charge.refunded", {
        payment_intent: "pi_123",
        amount_refunded: 38970,
        currency: "eur",
      }),
    );

    expect(mapped?.amountMinor).toBe(38970);
    expect(mapped?.refundId).toBeUndefined();
  });

  it("reads the payment intent whether it is an id or an expanded object", () => {
    const asString = normalizeStripeEvent(
      event("charge.refunded", {
        payment_intent: "pi_str",
        amount_refunded: 100,
        currency: "eur",
      }),
    );
    const asObject = normalizeStripeEvent(
      event("charge.refunded", {
        payment_intent: { id: "pi_obj" },
        amount_refunded: 100,
        currency: "eur",
      }),
    );

    expect(asString?.paymentIntentId).toBe("pi_str");
    expect(asObject?.paymentIntentId).toBe("pi_obj");
  });
});

describe("everything else", () => {
  it("is signed and genuine but not acted on", () => {
    // Stripe emits dozens of event types. Mapping an unrecognized one onto a
    // state change we did not intend is how a booking gets confirmed by an
    // invoice notification.
    expect(normalizeStripeEvent(event("invoice.paid", {}))).toBeNull();
    expect(normalizeStripeEvent(event("customer.created", {}))).toBeNull();
    expect(normalizeStripeEvent(event("charge.succeeded", {}))).toBeNull();
  });
});
