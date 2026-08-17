import { toDecimalString } from "@stayfinder/shared";
import request from "supertest";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAdapters } from "../adapters";
import { createApp } from "../app";
import {
  jsonHandler,
  plainTextHandler,
  silentHandler,
  startFixtureServer,
  type FixtureHandler,
  type FixtureServer,
} from "../testing/fixture-server";
import { closeTestDatabase, hasTestDatabase, resetDatabase, testPrisma } from "../testing/database";
import { parseOptionId } from "./quote";

/** Live quote payloads matching what the M2 suppliers actually return. */
const ALPHA_QUOTE = {
  hotelId: "ALPHA-1042",
  name: "Grand Meridian Lisbon",
  city: "Lisbon",
  starRating: 5,
  nightlyRateCents: 12990,
  currency: "EUR",
  nights: 3,
  refundable: true,
};

const BETA_QUOTE = {
  hotel_id: "bt_88",
  hotel_name: "Grand Meridian, Lisbon",
  city_name: "Lisbon",
  category: "4_STAR",
  total_price: "375.00",
  currency: "EUR",
  nights: 3,
  cancellation_policy: "FREE_CANCELLATION",
};

function gammaQuote(amount: number, priceChanged = false) {
  return {
    data: {
      hotelQuote: {
        hotelId: "gamma:hotel:7",
        nights: 3,
        priceChanged,
        property: { name: "GRAND MERIDIAN LISBON", city: "Lisbon", rating: { stars: 5 } },
        pricing: { refundable: false, perNight: { amount, currency: { code: "EUR" } } },
      },
    },
  };
}

const STAY = { checkIn: "2026-09-01", checkOut: "2026-09-04", guests: 2 };

describe("parseOptionId", () => {
  it("splits a namespaced option id", () => {
    expect(parseOptionId("alpha:ALPHA-1042")).toEqual({
      supplier: "alpha",
      supplierHotelId: "ALPHA-1042",
    });
  });

  it("keeps colons inside a supplier's own id", () => {
    // Gamma's ids contain colons, so only the first one separates.
    expect(parseOptionId("gamma:gamma:hotel:7")).toEqual({
      supplier: "gamma",
      supplierHotelId: "gamma:hotel:7",
    });
  });
});

const describeDb = hasTestDatabase ? describe : describe.skip;

describeDb("POST /api/quote", () => {
  let servers: FixtureServer[] = [];

  beforeEach(async () => {
    await resetDatabase();
  });

  afterEach(async () => {
    await Promise.all(servers.map((server) => server.close()));
    servers = [];
  });

  afterAll(async () => {
    await closeTestDatabase();
  });

  async function appWith(handlers: {
    alpha?: FixtureHandler;
    beta?: FixtureHandler;
    gamma?: FixtureHandler;
    timeoutMs?: number;
  }) {
    const alpha = await startFixtureServer(handlers.alpha ?? jsonHandler(ALPHA_QUOTE));
    const beta = await startFixtureServer(handlers.beta ?? jsonHandler(BETA_QUOTE));
    const gamma = await startFixtureServer(handlers.gamma ?? jsonHandler(gammaQuote(13500)));
    servers = [alpha, beta, gamma];

    return {
      app: createApp({
        adapters: createAdapters({ alpha: alpha.url, beta: beta.url, gamma: gamma.url }),
        prisma: testPrisma(),
        timeoutMs: handlers.timeoutMs ?? 500,
      }),
      alpha,
      beta,
      gamma,
    };
  }

  describe("when the price has not moved", () => {
    it("returns OK with the live price", async () => {
      const { app } = await appWith({});

      const res = await request(app)
        .post("/api/quote")
        .send({ optionId: "alpha:ALPHA-1042", ...STAY, searchedTotalMinor: 38970 })
        .expect(200);

      expect(res.body.status).toBe("OK");
      expect(res.body.quote.totalPrice.amountMinor).toBe(38970);
      expect(res.body.previousTotal).toBeUndefined();
    });

    it("takes the property details from the supplier, not the client", async () => {
      // The booking record is built from this, so nothing about it may depend on
      // what the caller claimed it was displaying.
      const { app } = await appWith({});

      const res = await request(app)
        .post("/api/quote")
        .send({ optionId: "alpha:ALPHA-1042", ...STAY })
        .expect(200);

      expect(res.body.quote.hotelName).toBe("Grand Meridian Lisbon");
      expect(res.body.quote.city).toBe("Lisbon");
      expect(res.body.quote.starRating).toBe(5);
    });

    it("persists the quote with an expiry", async () => {
      const { app } = await appWith({});

      const res = await request(app)
        .post("/api/quote")
        .send({ optionId: "alpha:ALPHA-1042", ...STAY })
        .expect(200);

      const stored = await testPrisma().quote.findUnique({ where: { id: res.body.quote.id } });
      expect(stored).not.toBeNull();
      expect(stored!.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it("normalizes Beta's stay total into both bases", async () => {
      const { app } = await appWith({});

      const res = await request(app)
        .post("/api/quote")
        .send({ optionId: "beta:bt_88", ...STAY, searchedTotalMinor: 37500 })
        .expect(200);

      expect(res.body.status).toBe("OK");
      expect(res.body.quote.totalPrice.amountMinor).toBe(37500);
      expect(res.body.quote.nightlyRate.amountMinor).toBe(12500);
    });

    it("digs Gamma's price out of its nested payload", async () => {
      const { app } = await appWith({});

      const res = await request(app)
        .post("/api/quote")
        .send({ optionId: "gamma:gamma:hotel:7", ...STAY, searchedTotalMinor: 40500 })
        .expect(200);

      expect(res.body.status).toBe("OK");
      expect(res.body.quote.nightlyRate.amountMinor).toBe(13500);
      expect(res.body.quote.refundable).toBe(false);
    });

    it("omits the comparison entirely when the client did not say what it showed", async () => {
      const { app } = await appWith({});

      const res = await request(app)
        .post("/api/quote")
        .send({ optionId: "alpha:ALPHA-1042", ...STAY })
        .expect(200);

      // No searched price means nothing to compare against — not a change.
      expect(res.body.status).toBe("OK");
    });
  });

  describe("when the supplier has moved the price", () => {
    it("returns PRICE_CHANGED with both amounts", async () => {
      const { app } = await appWith({ gamma: jsonHandler(gammaQuote(14066, true)) });

      const res = await request(app)
        .post("/api/quote")
        .send({ optionId: "gamma:gamma:hotel:7", ...STAY, searchedTotalMinor: 40500 })
        .expect(200);

      expect(res.body.status).toBe("PRICE_CHANGED");
      expect(res.body.previousTotal.amountMinor).toBe(40500);
      expect(res.body.quote.totalPrice.amountMinor).toBe(42198);
      expect(toDecimalString(res.body.quote.totalPrice)).toBe("421.98");
    });

    it("flags a change of a single cent — there is no tolerance band", async () => {
      // A price the user did not see is a price the user did not agree to.
      const { app } = await appWith({});

      const res = await request(app)
        .post("/api/quote")
        .send({ optionId: "alpha:ALPHA-1042", ...STAY, searchedTotalMinor: 38971 })
        .expect(200);

      expect(res.body.status).toBe("PRICE_CHANGED");
    });

    it("flags a change downward as well as upward", async () => {
      const { app } = await appWith({ gamma: jsonHandler(gammaQuote(12610, true)) });

      const res = await request(app)
        .post("/api/quote")
        .send({ optionId: "gamma:gamma:hotel:7", ...STAY, searchedTotalMinor: 40500 })
        .expect(200);

      expect(res.body.status).toBe("PRICE_CHANGED");
      expect(res.body.quote.totalPrice.amountMinor).toBeLessThan(40500);
    });

    it("records the change on the persisted quote", async () => {
      const { app } = await appWith({ gamma: jsonHandler(gammaQuote(14066, true)) });

      const res = await request(app)
        .post("/api/quote")
        .send({ optionId: "gamma:gamma:hotel:7", ...STAY, searchedTotalMinor: 40500 })
        .expect(200);

      const stored = await testPrisma().quote.findUniqueOrThrow({
        where: { id: res.body.quote.id },
      });
      expect(stored.priceChanged).toBe(true);
      expect(stored.searchedTotalMinor).toBe(40500);
    });

    it("does not trust Gamma's own priceChanged flag", async () => {
      // Gamma volunteers it; a real supplier would not. The aggregator compares
      // the amounts itself, so an honest-looking flag with an unchanged price is
      // still OK.
      const { app } = await appWith({ gamma: jsonHandler(gammaQuote(13500, true)) });

      const res = await request(app)
        .post("/api/quote")
        .send({ optionId: "gamma:gamma:hotel:7", ...STAY, searchedTotalMinor: 40500 })
        .expect(200);

      expect(res.body.status).toBe("OK");
    });
  });

  describe("failure", () => {
    it("fails rather than degrades when the supplier is down", async () => {
      // The opposite policy from search: there is no useful partial answer to
      // "what will this cost".
      const { app } = await appWith({ alpha: plainTextHandler(500) });

      const res = await request(app)
        .post("/api/quote")
        .send({ optionId: "alpha:ALPHA-1042", ...STAY })
        .expect(502);

      expect(res.body.error).toBe("SUPPLIER_UNAVAILABLE");
      expect(res.body.supplier).toBe("alpha");
    });

    it("fails rather than degrades when the supplier times out", async () => {
      const { app } = await appWith({ alpha: silentHandler(), timeoutMs: 120 });

      const res = await request(app)
        .post("/api/quote")
        .send({ optionId: "alpha:ALPHA-1042", ...STAY })
        .expect(502);

      expect(res.body.error).toBe("SUPPLIER_UNAVAILABLE");
    });

    it("stores nothing when the quote could not be obtained", async () => {
      const { app } = await appWith({ alpha: plainTextHandler(500) });

      await request(app)
        .post("/api/quote")
        .send({ optionId: "alpha:ALPHA-1042", ...STAY })
        .expect(502);

      expect(await testPrisma().quote.count()).toBe(0);
    });

    it("404s a hotel the supplier does not have", async () => {
      const { app } = await appWith({ alpha: jsonHandler({ error: "HOTEL_NOT_FOUND" }, 404) });

      const res = await request(app)
        .post("/api/quote")
        .send({ optionId: "alpha:NOPE", ...STAY })
        .expect(404);

      expect(res.body.error).toBe("HOTEL_NOT_FOUND");
    });

    it("404s a hotel Gamma reports missing through a GraphQL error", async () => {
      const { app } = await appWith({
        gamma: jsonHandler({
          errors: [{ message: "No such hotel", extensions: { code: "HOTEL_NOT_FOUND" } }],
          data: null,
        }),
      });

      const res = await request(app)
        .post("/api/quote")
        .send({ optionId: "gamma:gamma:hotel:0", ...STAY })
        .expect(404);

      expect(res.body.error).toBe("HOTEL_NOT_FOUND");
    });

    it("rejects an option id for a supplier that does not exist", async () => {
      const { app } = await appWith({});

      await request(app)
        .post("/api/quote")
        .send({ optionId: "delta:whatever", ...STAY })
        .expect(400);
    });

    it("rejects a malformed request", async () => {
      const { app } = await appWith({});

      const res = await request(app)
        .post("/api/quote")
        .send({ optionId: "not-namespaced", ...STAY })
        .expect(400);

      expect(res.body.error).toBe("INVALID_REQUEST");
    });

    it("rejects a stay of less than one night", async () => {
      const { app } = await appWith({});

      const res = await request(app)
        .post("/api/quote")
        .send({
          optionId: "alpha:ALPHA-1042",
          checkIn: "2026-09-04",
          checkOut: "2026-09-01",
          guests: 2,
        })
        .expect(400);

      expect(res.body.issues[0].field).toBe("checkOut");
    });
  });
});
