import { fromMinor, netAmountMinor } from "@stayfinder/shared";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { BookingRepository } from "../db/bookings";
import { LedgerRepository } from "../db/ledger";
import { QuoteRepository, type NewQuote } from "../db/quotes";
import { closeTestDatabase, hasTestDatabase, resetDatabase, testPrisma } from "../testing/database";
import { FakePaymentProvider, signPayload, type FakeEventPayload } from "./fake";

const WEBHOOK_SECRET = "whsec_test_secret";
const describeDb = hasTestDatabase ? describe : describe.skip;

function quoteInput(overrides: Partial<NewQuote> = {}): NewQuote {
  return {
    supplier: "alpha",
    supplierHotelId: "ALPHA-1042",
    hotelName: "Grand Meridian Lisbon",
    city: "Lisbon",
    starRating: 5,
    checkIn: "2026-09-01",
    checkOut: "2026-09-04",
    nights: 3,
    guests: 2,
    nightlyRate: fromMinor(12990, "EUR"),
    totalPrice: fromMinor(38970, "EUR"),
    refundable: true,
    searchedTotalMinor: 38970,
    priceChanged: false,
    ...overrides,
  };
}

describeDb("payments", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await closeTestDatabase();
  });

  /**
   * One app, and one provider, for the whole suite. A fresh provider per call
   * would give each request its own idempotency memory, which is precisely the
   * behaviour under test.
   */
  let server: ReturnType<typeof createApp>;

  beforeEach(() => {
    server = createApp({
      adapters: [],
      prisma: testPrisma(),
      webhookSecret: WEBHOOK_SECRET,
      paymentProvider: new FakePaymentProvider({ webhookSecret: WEBHOOK_SECRET }),
    });
  });

  function app() {
    return server;
  }

  /** A booking that has started checkout, so a webhook can be matched to it. */
  async function bookingReadyForPayment(key = `key-${Math.random()}`) {
    const quote = await new QuoteRepository(testPrisma()).create(quoteInput());
    const { booking } = await new BookingRepository(testPrisma()).create({
      quote,
      idempotencyKey: key,
      guestName: "Ada Lovelace",
      guestEmail: "ada@example.com",
    });

    const intent = await request(app())
      .post(`/api/bookings/${booking.id}/payment-intent`)
      .expect(200);

    return { bookingId: booking.id, paymentIntentId: intent.body.paymentIntentId as string };
  }

  /** Post a correctly signed delivery, exactly as the provider would. */
  function deliver(
    payload: FakeEventPayload,
    options: { secret?: string; timestamp?: number; signature?: string } = {},
  ) {
    const raw = JSON.stringify(payload);
    const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000);
    const signature =
      options.signature ?? signPayload(options.secret ?? WEBHOOK_SECRET, raw, timestamp);

    // Sent as a *string*, not a Buffer. With `content-type: application/json`,
    // superagent JSON-serializes a Buffer into `{"type":"Buffer","data":[…]}`,
    // so the bytes that arrive are not the bytes that were signed — and the
    // failure looks like a signature bug rather than a test bug.
    return request(app())
      .post("/api/webhooks/stripe")
      .set("content-type", "application/json")
      .set("stripe-signature", signature)
      .send(raw);
  }

  function succeeded(paymentIntentId: string, eventId: string, amountMinor = 38970) {
    return {
      id: eventId,
      type: "payment_intent.succeeded",
      data: { paymentIntentId, amountMinor, currency: "EUR" },
    } satisfies FakeEventPayload;
  }

  describe("payment intent", () => {
    it("creates an intent and records it on the booking", async () => {
      const { bookingId, paymentIntentId } = await bookingReadyForPayment();

      const stored = await testPrisma().booking.findUniqueOrThrow({ where: { id: bookingId } });
      expect(stored.paymentIntentId).toBe(paymentIntentId);
      expect(stored.status).toBe("PENDING");
    });

    it("does not confirm anything on its own", async () => {
      // Confirmation is the webhook's job. If starting checkout could confirm,
      // a user closing the tab mid-payment would leave a confirmed booking.
      const { bookingId } = await bookingReadyForPayment();

      const res = await request(app()).get(`/api/bookings/${bookingId}`).expect(200);
      expect(res.body.booking.status).toBe("PENDING");
      expect(res.body.transactions).toEqual([]);
    });

    it("returns the same intent when checkout is started twice", async () => {
      const { bookingId, paymentIntentId } = await bookingReadyForPayment();

      const second = await request(app())
        .post(`/api/bookings/${bookingId}/payment-intent`)
        .expect(200);

      expect(second.body.paymentIntentId).toBe(paymentIntentId);
    });

    it("refuses a booking that cannot be paid for", async () => {
      const { bookingId, paymentIntentId } = await bookingReadyForPayment();
      await deliver(succeeded(paymentIntentId, "evt_confirm_first")).expect(200);

      const res = await request(app())
        .post(`/api/bookings/${bookingId}/payment-intent`)
        .expect(409);

      expect(res.body.error).toBe("ILLEGAL_TRANSITION");
      expect(res.body.status).toBe("CONFIRMED");
    });
  });

  describe("signature verification", () => {
    it("rejects a delivery with no signature", async () => {
      const { paymentIntentId } = await bookingReadyForPayment();

      const res = await request(app())
        .post("/api/webhooks/stripe")
        .set("content-type", "application/json")
        .send(JSON.stringify(succeeded(paymentIntentId, "evt_unsigned")))
        .expect(400);

      expect(res.body.error).toBe("INVALID_SIGNATURE");
    });

    it("rejects a signature made with the wrong secret", async () => {
      const { paymentIntentId } = await bookingReadyForPayment();

      await deliver(succeeded(paymentIntentId, "evt_wrong_secret"), {
        secret: "whsec_not_ours",
      }).expect(400);
    });

    it("rejects a signature that does not cover this payload", async () => {
      // A real signature, lifted from another delivery. Without checking the
      // body, replaying someone else's event would confirm this booking.
      const { paymentIntentId } = await bookingReadyForPayment();
      const other = JSON.stringify(succeeded("pi_someone_else", "evt_other"));
      const timestamp = Math.floor(Date.now() / 1000);

      await deliver(succeeded(paymentIntentId, "evt_mismatched"), {
        signature: signPayload(WEBHOOK_SECRET, other, timestamp),
        timestamp,
      }).expect(400);
    });

    it("rejects a stale delivery, so a captured signature cannot be replayed later", async () => {
      const { paymentIntentId } = await bookingReadyForPayment();
      const longAgo = Math.floor(Date.now() / 1000) - 3600;

      await deliver(succeeded(paymentIntentId, "evt_stale"), { timestamp: longAgo }).expect(400);
    });

    it("changes nothing when the signature is rejected", async () => {
      const { bookingId, paymentIntentId } = await bookingReadyForPayment();

      await deliver(succeeded(paymentIntentId, "evt_bad"), { secret: "nope" }).expect(400);

      const stored = await testPrisma().booking.findUniqueOrThrow({ where: { id: bookingId } });
      expect(stored.status).toBe("PENDING");
      expect(await testPrisma().webhookEvent.count()).toBe(0);
      expect(await testPrisma().transaction.count()).toBe(0);
    });
  });

  describe("confirmation", () => {
    it("confirms the booking and appends a charge", async () => {
      const { bookingId, paymentIntentId } = await bookingReadyForPayment();

      const res = await deliver(succeeded(paymentIntentId, "evt_ok")).expect(200);
      expect(res.body.outcome).toBe("processed");

      const booking = await request(app()).get(`/api/bookings/${bookingId}`).expect(200);
      expect(booking.body.booking.status).toBe("CONFIRMED");
      expect(booking.body.transactions).toHaveLength(1);
      expect(booking.body.transactions[0].kind).toBe("CHARGE");
      expect(booking.body.transactions[0].amount.amountMinor).toBe(38970);
    });

    it("records the state change in the timeline", async () => {
      const { bookingId, paymentIntentId } = await bookingReadyForPayment();
      await deliver(succeeded(paymentIntentId, "evt_timeline")).expect(200);

      const res = await request(app()).get(`/api/bookings/${bookingId}`).expect(200);

      expect(res.body.events.map((e: { to: string }) => e.to)).toEqual(["PENDING", "CONFIRMED"]);
      expect(res.body.events[1].transition).toBe("confirm");
    });

    it("drives a failed payment to FAILED without touching the ledger", async () => {
      const { bookingId, paymentIntentId } = await bookingReadyForPayment();

      await deliver({
        id: "evt_failed",
        type: "payment_intent.payment_failed",
        data: { paymentIntentId, amountMinor: 38970, currency: "EUR" },
      }).expect(200);

      const res = await request(app()).get(`/api/bookings/${bookingId}`).expect(200);
      expect(res.body.booking.status).toBe("FAILED");
      // No money moved, so there is nothing to record.
      expect(res.body.transactions).toEqual([]);
    });

    it("acknowledges an event type it does not act on", async () => {
      const { paymentIntentId } = await bookingReadyForPayment();

      const res = await deliver({
        id: "evt_unrelated",
        type: "customer.subscription.updated",
        data: { paymentIntentId, amountMinor: 0, currency: "EUR" },
      }).expect(200);

      // 200 rather than 4xx: a non-2xx has the provider redelivering forever.
      expect(res.body.outcome).toBe("ignored_event_type");
    });

    it("acknowledges an event for a booking it has never heard of", async () => {
      const res = await deliver(succeeded("pi_does_not_exist", "evt_orphan")).expect(200);

      expect(res.body.outcome).toBe("unknown_booking");
    });
  });

  describe("duplicate delivery", () => {
    it("confirms once when the same event arrives five times", async () => {
      // Stripe makes no at-most-once promise and retries after any non-2xx, so
      // this is the normal operating condition rather than an edge case.
      const { bookingId, paymentIntentId } = await bookingReadyForPayment();
      const event = succeeded(paymentIntentId, "evt_repeated");

      const outcomes: string[] = [];
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const res = await deliver(event).expect(200);
        outcomes.push(res.body.outcome);
      }

      expect(outcomes).toEqual(["processed", "duplicate", "duplicate", "duplicate", "duplicate"]);

      const res = await request(app()).get(`/api/bookings/${bookingId}`).expect(200);
      expect(res.body.booking.status).toBe("CONFIRMED");
      // One charge, one state change. Not five.
      expect(res.body.transactions).toHaveLength(1);
      expect(res.body.events).toHaveLength(2);
    });

    it("no-ops a different event that would repeat a transition already made", async () => {
      // Same outcome, different mechanism: this event id is new, so the primary
      // key does not catch it. The state machine does — a considered no-op
      // rather than a caught exception.
      const { bookingId, paymentIntentId } = await bookingReadyForPayment();
      await deliver(succeeded(paymentIntentId, "evt_first")).expect(200);

      const res = await deliver(succeeded(paymentIntentId, "evt_second")).expect(200);

      expect(res.body.outcome).toBe("already_in_state");
      const booking = await request(app()).get(`/api/bookings/${bookingId}`).expect(200);
      expect(booking.body.transactions).toHaveLength(1);
    });

    it("records the event id exactly once", async () => {
      const { paymentIntentId } = await bookingReadyForPayment();
      const event = succeeded(paymentIntentId, "evt_counted");

      await deliver(event).expect(200);
      await deliver(event).expect(200);

      expect(await testPrisma().webhookEvent.count()).toBe(1);
    });
  });

  describe("cancel and refund", () => {
    async function confirmedBooking() {
      const ready = await bookingReadyForPayment();
      await deliver(succeeded(ready.paymentIntentId, `evt_${ready.bookingId}`)).expect(200);
      return ready;
    }

    it("cancels a confirmed booking and requests a refund", async () => {
      const { bookingId } = await confirmedBooking();

      const res = await request(app()).post(`/api/bookings/${bookingId}/cancel`).expect(200);

      expect(res.body.booking.status).toBe("CANCELLED");
      expect(res.body.refundRequested).toBe(true);
    });

    it("does not reach REFUNDED until the refund webhook arrives", async () => {
      // CANCELLED is a real waiting state: cancelled, money not yet returned.
      const { bookingId } = await confirmedBooking();
      await request(app()).post(`/api/bookings/${bookingId}/cancel`).expect(200);

      const res = await request(app()).get(`/api/bookings/${bookingId}`).expect(200);
      expect(res.body.booking.status).toBe("CANCELLED");
      expect(res.body.transactions).toHaveLength(1);
    });

    it("completes the path when the refund webhook lands", async () => {
      const { bookingId, paymentIntentId } = await confirmedBooking();
      await request(app()).post(`/api/bookings/${bookingId}/cancel`).expect(200);

      await deliver({
        id: "evt_refunded",
        type: "charge.refunded",
        data: {
          paymentIntentId,
          amountMinor: 38970,
          currency: "EUR",
          refundId: "re_test_1",
        },
      }).expect(200);

      const res = await request(app()).get(`/api/bookings/${bookingId}`).expect(200);
      expect(res.body.booking.status).toBe("REFUNDED");
      expect(res.body.transactions.map((t: { kind: string }) => t.kind)).toEqual([
        "CHARGE",
        "REFUND",
      ]);
      expect(netAmountMinor(res.body.transactions)).toBe(0);
    });

    it("does not double-refund on a duplicate refund webhook", async () => {
      const { bookingId, paymentIntentId } = await confirmedBooking();
      await request(app()).post(`/api/bookings/${bookingId}/cancel`).expect(200);

      const refund = {
        id: "evt_refund_twice",
        type: "charge.refunded",
        data: { paymentIntentId, amountMinor: 38970, currency: "EUR", refundId: "re_1" },
      } satisfies FakeEventPayload;

      await deliver(refund).expect(200);
      await deliver(refund).expect(200);

      const res = await request(app()).get(`/api/bookings/${bookingId}`).expect(200);
      expect(res.body.transactions).toHaveLength(2);
      expect(netAmountMinor(res.body.transactions)).toBe(0);
    });

    it("cancels an unpaid booking without requesting a refund", async () => {
      const { bookingId } = await bookingReadyForPayment();

      const res = await request(app()).post(`/api/bookings/${bookingId}/cancel`).expect(200);

      expect(res.body.booking.status).toBe("CANCELLED");
      expect(res.body.refundRequested).toBe(false);
    });

    it("refuses to cancel a booking the machine says cannot be cancelled", async () => {
      const { bookingId, paymentIntentId } = await confirmedBooking();
      await request(app()).post(`/api/bookings/${bookingId}/cancel`).expect(200);
      await deliver({
        id: "evt_final",
        type: "charge.refunded",
        data: { paymentIntentId, amountMinor: 38970, currency: "EUR", refundId: "re_2" },
      }).expect(200);

      const res = await request(app()).post(`/api/bookings/${bookingId}/cancel`).expect(409);

      expect(res.body.error).toBe("ILLEGAL_TRANSITION");
      expect(res.body.status).toBe("REFUNDED");
      expect(res.body.allowed).toEqual([]);
    });
  });

  describe("the ledger is append-only", () => {
    it("is enforced by the database, not by convention", async () => {
      // The repository has no update method — but that only proves our code does
      // not do it. This proves nothing can.
      const { bookingId, paymentIntentId } = await bookingReadyForPayment();
      await deliver(succeeded(paymentIntentId, "evt_ledger")).expect(200);

      const row = await testPrisma().transaction.findFirstOrThrow({ where: { bookingId } });

      await expect(
        testPrisma().$executeRawUnsafe(
          `UPDATE transactions SET "amountMinor" = 1 WHERE id = '${row.id}'`,
        ),
      ).rejects.toThrow(/append-only/);

      await expect(
        testPrisma().$executeRawUnsafe(`DELETE FROM transactions WHERE id = '${row.id}'`),
      ).rejects.toThrow(/append-only/);
    });

    it("leaves the row untouched after a refused write", async () => {
      const { bookingId, paymentIntentId } = await bookingReadyForPayment();
      await deliver(succeeded(paymentIntentId, "evt_intact")).expect(200);
      const row = await testPrisma().transaction.findFirstOrThrow({ where: { bookingId } });

      await testPrisma()
        .$executeRawUnsafe(`UPDATE transactions SET "amountMinor" = 1 WHERE id = '${row.id}'`)
        .catch(() => undefined);

      const after = await testPrisma().transaction.findFirstOrThrow({ where: { id: row.id } });
      expect(after.amountMinor).toBe(38970);
    });

    it("derives the balance from rows rather than storing it", async () => {
      const { bookingId, paymentIntentId } = await bookingReadyForPayment();
      const ledger = new LedgerRepository(testPrisma());

      await deliver(succeeded(paymentIntentId, "evt_bal_1")).expect(200);
      expect(await ledger.balanceMinor(bookingId)).toBe(38970);

      await request(app()).post(`/api/bookings/${bookingId}/cancel`).expect(200);
      await deliver({
        id: "evt_bal_2",
        type: "charge.refunded",
        data: { paymentIntentId, amountMinor: 38970, currency: "EUR", refundId: "re_bal" },
      }).expect(200);

      expect(await ledger.balanceMinor(bookingId)).toBe(0);
    });
  });

  describe("the dev delivery route", () => {
    it("drives the real webhook handler, signature and all", async () => {
      const { bookingId } = await bookingReadyForPayment();

      const res = await request(app())
        .post("/api/dev/payment-events")
        .send({ bookingId, type: "payment_intent.succeeded" })
        .expect(200);

      expect(res.body.outcome).toBe("processed");
      const booking = await request(app()).get(`/api/bookings/${bookingId}`).expect(200);
      expect(booking.body.booking.status).toBe("CONFIRMED");
    });

    it("can redeliver a chosen event id, which is what chaos mode will do", async () => {
      const { bookingId } = await bookingReadyForPayment();
      const body = { bookingId, type: "payment_intent.succeeded", eventId: "evt_chaos" };

      const first = await request(app()).post("/api/dev/payment-events").send(body).expect(200);
      const second = await request(app()).post("/api/dev/payment-events").send(body).expect(200);

      expect(first.body.outcome).toBe("processed");
      expect(second.body.outcome).toBe("duplicate");
    });

    it("refuses to deliver for a booking that has not started checkout", async () => {
      const quote = await new QuoteRepository(testPrisma()).create(quoteInput());
      const { booking } = await new BookingRepository(testPrisma()).create({
        quote,
        idempotencyKey: "no-checkout",
        guestName: "Ada Lovelace",
        guestEmail: "ada@example.com",
      });

      const res = await request(app())
        .post("/api/dev/payment-events")
        .send({ bookingId: booking.id, type: "payment_intent.succeeded" })
        .expect(409);

      expect(res.body.error).toBe("NO_PAYMENT_INTENT");
    });
  });
});
