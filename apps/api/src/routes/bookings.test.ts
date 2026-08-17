import { fromMinor } from "@stayfinder/shared";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { BookingRepository } from "../db/bookings";
import { QuoteRepository, type NewQuote } from "../db/quotes";
import { closeTestDatabase, hasTestDatabase, resetDatabase, testPrisma } from "../testing/database";

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

const GUEST = { guestName: "Ada Lovelace", guestEmail: "ada@example.com" };

describeDb("bookings", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await closeTestDatabase();
  });

  /** `now` is injectable so quote expiry can be forced without waiting. */
  function app(now?: () => Date) {
    return createApp({
      adapters: [],
      prisma: testPrisma(),
      ...(now === undefined ? {} : { now }),
    });
  }

  async function seedQuote(overrides: Partial<NewQuote> = {}, now?: () => Date) {
    const repo = new QuoteRepository(testPrisma(), now);
    return repo.create(quoteInput(overrides));
  }

  describe("POST /api/bookings", () => {
    it("creates a PENDING booking from a live quote", async () => {
      const quote = await seedQuote();

      const res = await request(app())
        .post("/api/bookings")
        .set("Idempotency-Key", "key-1")
        .send({ quoteId: quote.id, ...GUEST })
        .expect(201);

      expect(res.body.created).toBe(true);
      expect(res.body.booking.status).toBe("PENDING");
      expect(res.body.booking.total.amountMinor).toBe(38970);
      expect(res.body.booking.hotelName).toBe("Grand Meridian Lisbon");
    });

    it("charges the quote's amount, not anything the client sent", async () => {
      const quote = await seedQuote({ totalPrice: fromMinor(12345, "EUR") });

      const res = await request(app())
        .post("/api/bookings")
        .set("Idempotency-Key", "key-price")
        // A hopeful client tries to slip a total in. It is ignored.
        .send({ quoteId: quote.id, ...GUEST, totalMinor: 1 })
        .expect(201);

      expect(res.body.booking.total.amountMinor).toBe(12345);
    });

    it("records the booking's first state event", async () => {
      const quote = await seedQuote();

      const created = await request(app())
        .post("/api/bookings")
        .set("Idempotency-Key", "key-2")
        .send({ quoteId: quote.id, ...GUEST })
        .expect(201);

      const res = await request(app()).get(`/api/bookings/${created.body.booking.id}`).expect(200);

      expect(res.body.events).toHaveLength(1);
      expect(res.body.events[0]).toMatchObject({ from: null, to: "PENDING", transition: null });
    });

    it("requires an idempotency key", async () => {
      const quote = await seedQuote();

      const res = await request(app())
        .post("/api/bookings")
        .send({ quoteId: quote.id, ...GUEST })
        .expect(400);

      expect(res.body.error).toBe("IDEMPOTENCY_KEY_REQUIRED");
    });

    it("404s an unknown quote", async () => {
      const res = await request(app())
        .post("/api/bookings")
        .set("Idempotency-Key", "key-3")
        .send({ quoteId: "00000000-0000-0000-0000-000000000000", ...GUEST })
        .expect(404);

      expect(res.body.error).toBe("QUOTE_NOT_FOUND");
    });

    it("rejects a malformed guest", async () => {
      const quote = await seedQuote();

      const res = await request(app())
        .post("/api/bookings")
        .set("Idempotency-Key", "key-4")
        .send({ quoteId: quote.id, guestName: "", guestEmail: "not-an-email" })
        .expect(400);

      expect(res.body.error).toBe("INVALID_REQUEST");
      expect(res.body.issues.map((i: { field: string }) => i.field).sort()).toEqual([
        "guestEmail",
        "guestName",
      ]);
    });
  });

  describe("expired and consumed quotes", () => {
    it("refuses to book an expired quote rather than quietly re-quoting", async () => {
      // The user agreed to a specific number. Substituting a fresh one is exactly
      // what the whole PRICE_CHANGED flow exists to prevent.
      const past = new Date(Date.now() - 60 * 60 * 1000);
      const quote = await seedQuote({}, () => past);

      const res = await request(app())
        .post("/api/bookings")
        .set("Idempotency-Key", "key-5")
        .send({ quoteId: quote.id, ...GUEST })
        .expect(409);

      expect(res.body.error).toBe("QUOTE_EXPIRED");
      expect(await testPrisma().booking.count()).toBe(0);
    });

    it("refuses to book the same quote twice, even with a fresh key", async () => {
      const quote = await seedQuote();

      await request(app())
        .post("/api/bookings")
        .set("Idempotency-Key", "key-6a")
        .send({ quoteId: quote.id, ...GUEST })
        .expect(201);

      const res = await request(app())
        .post("/api/bookings")
        .set("Idempotency-Key", "key-6b")
        .send({ quoteId: quote.id, ...GUEST })
        .expect(409);

      expect(res.body.error).toBe("QUOTE_ALREADY_BOOKED");
      expect(await testPrisma().booking.count()).toBe(1);
    });
  });

  describe("idempotency", () => {
    it("returns the original booking on a replay, and creates only one row", async () => {
      const quote = await seedQuote();
      const body = { quoteId: quote.id, ...GUEST };

      const first = await request(app())
        .post("/api/bookings")
        .set("Idempotency-Key", "replay")
        .send(body)
        .expect(201);
      const second = await request(app())
        .post("/api/bookings")
        .set("Idempotency-Key", "replay")
        .send(body)
        .expect(200);

      expect(second.body.created).toBe(false);
      expect(second.body.booking.id).toBe(first.body.booking.id);
      expect(await testPrisma().booking.count()).toBe(1);
    });

    it("creates exactly one booking under concurrent identical requests", async () => {
      // The real guarantee is the unique index, not the lookup: a read-then-write
      // check races, and both callers would insert.
      const quote = await seedQuote();
      const body = { quoteId: quote.id, ...GUEST };
      const server = app();

      const responses = await Promise.all(
        Array.from({ length: 5 }, () =>
          request(server).post("/api/bookings").set("Idempotency-Key", "race").send(body),
        ),
      );

      const ids = new Set(
        responses
          .filter((res) => res.status === 200 || res.status === 201)
          .map((res) => res.body.booking.id as string),
      );

      expect(await testPrisma().booking.count()).toBe(1);
      expect(ids.size).toBe(1);
      expect(responses.filter((res) => res.status === 201)).toHaveLength(1);
    });

    it("adds exactly one state event under concurrent identical requests", async () => {
      const quote = await seedQuote();
      const body = { quoteId: quote.id, ...GUEST };
      const server = app();

      await Promise.all(
        Array.from({ length: 5 }, () =>
          request(server).post("/api/bookings").set("Idempotency-Key", "race-events").send(body),
        ),
      );

      expect(await testPrisma().bookingEvent.count()).toBe(1);
    });

    it("survives two repository writes racing on one key", async () => {
      // Driven at the repository level rather than over HTTP, so both calls make
      // their pre-flight lookup before either insert lands — which is the only
      // way to reach the constraint-recovery branch rather than the fast path.
      const quote = await seedQuote();
      const repo = new BookingRepository(testPrisma());
      const input = { quote, idempotencyKey: "repo-race", ...GUEST };

      const results = await Promise.all([repo.create(input), repo.create(input)]);

      expect(await testPrisma().booking.count()).toBe(1);
      expect(new Set(results.map((r) => r.booking.id)).size).toBe(1);
      expect(results.filter((r) => r.created)).toHaveLength(1);
    });

    it("rejects a reused key carrying a different request", async () => {
      // A retry sends the same payload. A different payload under the same key is
      // a client bug, and answering with the earlier booking would hide it.
      const first = await seedQuote();
      const second = await seedQuote();

      await request(app())
        .post("/api/bookings")
        .set("Idempotency-Key", "reused")
        .send({ quoteId: first.id, ...GUEST })
        .expect(201);

      const res = await request(app())
        .post("/api/bookings")
        .set("Idempotency-Key", "reused")
        .send({ quoteId: second.id, ...GUEST })
        .expect(409);

      expect(res.body.error).toBe("IDEMPOTENCY_KEY_REUSED");
    });

    it("treats a different guest under the same key as a reuse", async () => {
      const quote = await seedQuote();

      await request(app())
        .post("/api/bookings")
        .set("Idempotency-Key", "reused-guest")
        .send({ quoteId: quote.id, ...GUEST })
        .expect(201);

      await request(app())
        .post("/api/bookings")
        .set("Idempotency-Key", "reused-guest")
        .send({ quoteId: quote.id, guestName: "Someone Else", guestEmail: "other@example.com" })
        .expect(409);
    });

    it("lets distinct keys create distinct bookings", async () => {
      const first = await seedQuote();
      const second = await seedQuote({ supplierHotelId: "ALPHA-1077" });

      await request(app())
        .post("/api/bookings")
        .set("Idempotency-Key", "distinct-a")
        .send({ quoteId: first.id, ...GUEST })
        .expect(201);
      await request(app())
        .post("/api/bookings")
        .set("Idempotency-Key", "distinct-b")
        .send({ quoteId: second.id, ...GUEST })
        .expect(201);

      expect(await testPrisma().booking.count()).toBe(2);
    });
  });

  describe("GET /api/bookings", () => {
    it("returns an empty list on a fresh database rather than erroring", async () => {
      const res = await request(app()).get("/api/bookings").expect(200);

      expect(res.body.bookings).toEqual([]);
    });

    it("lists recent bookings newest first", async () => {
      for (const name of ["first", "second", "third"]) {
        const quote = await seedQuote();
        await request(app())
          .post("/api/bookings")
          .set("Idempotency-Key", `recent-${name}`)
          .send({ quoteId: quote.id, ...GUEST })
          .expect(201);
      }

      const res = await request(app()).get("/api/bookings").expect(200);

      expect(res.body.bookings).toHaveLength(3);
      const times = res.body.bookings.map((b: { createdAt: string }) => b.createdAt);
      expect([...times].sort().reverse()).toEqual(times);
    });

    it("honours a limit", async () => {
      for (const name of ["a", "b", "c"]) {
        const quote = await seedQuote();
        await request(app())
          .post("/api/bookings")
          .set("Idempotency-Key", `limit-${name}`)
          .send({ quoteId: quote.id, ...GUEST })
          .expect(201);
      }

      const res = await request(app()).get("/api/bookings?limit=2").expect(200);

      expect(res.body.bookings).toHaveLength(2);
    });

    it("omits the guest email — the endpoint has no authentication", async () => {
      const quote = await seedQuote();
      await request(app())
        .post("/api/bookings")
        .set("Idempotency-Key", "redaction")
        .send({ quoteId: quote.id, ...GUEST })
        .expect(201);

      const res = await request(app()).get("/api/bookings").expect(200);

      expect(res.body.bookings[0].guestName).toBe("Ada Lovelace");
      expect(res.body.bookings[0].guestEmail).toBeUndefined();
    });
  });

  describe("GET /api/bookings/:id", () => {
    it("returns the booking with its timeline", async () => {
      const quote = await seedQuote();
      const created = await request(app())
        .post("/api/bookings")
        .set("Idempotency-Key", "timeline")
        .send({ quoteId: quote.id, ...GUEST })
        .expect(201);

      const res = await request(app()).get(`/api/bookings/${created.body.booking.id}`).expect(200);

      expect(res.body.booking.status).toBe("PENDING");
      expect(res.body.events).toHaveLength(1);
    });

    it("404s an unknown booking", async () => {
      const res = await request(app())
        .get("/api/bookings/00000000-0000-0000-0000-000000000000")
        .expect(404);

      expect(res.body.error).toBe("BOOKING_NOT_FOUND");
    });
  });
});
