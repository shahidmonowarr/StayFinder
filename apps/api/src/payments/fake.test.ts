import { describe, expect, it } from "vitest";
import { FakePaymentProvider, SIGNATURE_TOLERANCE_SECONDS, signPayload } from "./fake";
import { WebhookSignatureError } from "./types";

const SECRET = "whsec_unit_test";

/** Fixed clock, so the tolerance window can be walked without waiting. */
function providerAt(nowMs: number) {
  return new FakePaymentProvider({ webhookSecret: SECRET, now: () => nowMs });
}

const NOW = 1_770_000_000_000;
const NOW_SECONDS = Math.floor(NOW / 1000);

function payload(id = "evt_1") {
  return JSON.stringify({
    id,
    type: "payment_intent.succeeded",
    data: { paymentIntentId: "pi_1", amountMinor: 38970, currency: "EUR" },
  });
}

describe("signature verification", () => {
  it("accepts a correctly signed payload", () => {
    const body = payload();
    const event = providerAt(NOW).verifyWebhook(
      Buffer.from(body),
      signPayload(SECRET, body, NOW_SECONDS),
    );

    expect(event?.id).toBe("evt_1");
    expect(event?.kind).toBe("payment_succeeded");
    expect(event?.paymentIntentId).toBe("pi_1");
  });

  it("rejects a missing or malformed header", () => {
    const body = Buffer.from(payload());

    expect(() => providerAt(NOW).verifyWebhook(body, undefined)).toThrow(WebhookSignatureError);
    expect(() => providerAt(NOW).verifyWebhook(body, "")).toThrow(/Missing signature/);
    expect(() => providerAt(NOW).verifyWebhook(body, "garbage")).toThrow(/Malformed/);
  });

  it("rejects a body that differs from the one signed, even by a byte", () => {
    const signature = signPayload(SECRET, payload("evt_1"), NOW_SECONDS);

    expect(() => providerAt(NOW).verifyWebhook(Buffer.from(payload("evt_2")), signature)).toThrow(
      /does not match/,
    );
  });

  it("accepts a delivery at the edge of the tolerance window", () => {
    const at = NOW_SECONDS - SIGNATURE_TOLERANCE_SECONDS;
    const body = payload();

    expect(() =>
      providerAt(NOW).verifyWebhook(Buffer.from(body), signPayload(SECRET, body, at)),
    ).not.toThrow();
  });

  it("rejects one just outside it, so a captured signature expires", () => {
    const at = NOW_SECONDS - SIGNATURE_TOLERANCE_SECONDS - 1;
    const body = payload();

    expect(() =>
      providerAt(NOW).verifyWebhook(Buffer.from(body), signPayload(SECRET, body, at)),
    ).toThrow(/tolerance window/);
  });

  it("returns null for a signed event it does not act on", () => {
    // Valid and genuine, just not interesting. Distinct from a rejection.
    const body = JSON.stringify({ id: "evt_x", type: "invoice.paid", data: {} });

    const result = providerAt(NOW).verifyWebhook(
      Buffer.from(body),
      signPayload(SECRET, body, NOW_SECONDS),
    );

    expect(result).toBeNull();
  });

  it("rejects a signed payload that is not JSON", () => {
    const body = "not json at all";

    expect(() =>
      providerAt(NOW).verifyWebhook(Buffer.from(body), signPayload(SECRET, body, NOW_SECONDS)),
    ).toThrow(/not valid JSON/);
  });
});

describe("provider idempotency", () => {
  it("returns one intent for one key, so a double-click cannot charge twice", async () => {
    const provider = providerAt(NOW);
    const input = { bookingId: "b1", amountMinor: 38970, currency: "EUR", idempotencyKey: "pi-b1" };

    const first = await provider.createPaymentIntent(input);
    const second = await provider.createPaymentIntent(input);

    expect(second.id).toBe(first.id);
  });

  it("returns distinct intents for distinct keys", async () => {
    const provider = providerAt(NOW);

    const a = await provider.createPaymentIntent({
      bookingId: "b1",
      amountMinor: 100,
      currency: "EUR",
      idempotencyKey: "pi-b1",
    });
    const b = await provider.createPaymentIntent({
      bookingId: "b2",
      amountMinor: 100,
      currency: "EUR",
      idempotencyKey: "pi-b2",
    });

    expect(a.id).not.toBe(b.id);
  });

  it("returns one refund for one key", async () => {
    const provider = providerAt(NOW);
    const input = { paymentIntentId: "pi_1", amountMinor: 38970, idempotencyKey: "re-b1" };

    expect((await provider.refund(input)).id).toBe((await provider.refund(input)).id);
  });
});
