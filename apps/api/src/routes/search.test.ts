import { groupByProperty, type SearchResponse } from "@stayfinder/shared";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createAdapters } from "../adapters";
import {
  ALPHA_SEARCH_PAYLOAD,
  BETA_SEARCH_PAYLOAD,
  GAMMA_SEARCH_PAYLOAD,
} from "../adapters/fixtures";
import { createApp } from "../app";
import { resilientCache } from "../cache";
import {
  jsonHandler,
  plainTextHandler,
  silentHandler,
  startFixtureServer,
  type FixtureHandler,
  type FixtureServer,
} from "../testing/fixture-server";

const STAY = { destination: "Lisbon", checkIn: "2026-09-01", checkOut: "2026-09-04", guests: "2" };

let servers: FixtureServer[] = [];

afterEach(async () => {
  await Promise.all(servers.map((server) => server.close()));
  servers = [];
});

/** Stand up three fake suppliers and point a real app at them over real HTTP. */
async function appWith(handlers: {
  alpha?: FixtureHandler;
  beta?: FixtureHandler;
  gamma?: FixtureHandler;
  timeoutMs?: number;
}) {
  const alpha = await startFixtureServer(handlers.alpha ?? jsonHandler(ALPHA_SEARCH_PAYLOAD));
  const beta = await startFixtureServer(handlers.beta ?? jsonHandler(BETA_SEARCH_PAYLOAD));
  const gamma = await startFixtureServer(handlers.gamma ?? jsonHandler(GAMMA_SEARCH_PAYLOAD));
  servers = [alpha, beta, gamma];

  const app = createApp({
    adapters: createAdapters({ alpha: alpha.url, beta: beta.url, gamma: gamma.url }),
    timeoutMs: handlers.timeoutMs ?? 500,
  });

  return { app, alpha, beta, gamma };
}

function search(app: ReturnType<typeof createApp>, overrides: Record<string, string> = {}) {
  return request(app)
    .get("/api/search")
    .query({ ...STAY, ...overrides });
}

describe("GET /api/search — all three suppliers healthy", () => {
  it("merges every supplier's inventory into one sorted list", async () => {
    const { app } = await appWith({});

    const res = await search(app).expect(200);
    const body = res.body as SearchResponse;

    expect(body.options).toHaveLength(7);
    expect(body.suppliers.map((s) => s.status)).toEqual(["ok", "ok", "ok"]);
    expect(body.cached).toBe(false);

    // Cheapest first, and the ordering is exact rather than approximate — a
    // deterministic response is what makes the M4 streaming diff meaningful.
    expect(body.options.map((o) => o.totalPrice.amountMinor)).toEqual([
      16200, 18300, 24300, 25350, 37500, 38970, 40500,
    ]);
  });

  it("echoes the parsed query back, with guests coerced to a number", async () => {
    const { app } = await appWith({});

    const res = await search(app).expect(200);

    expect((res.body as SearchResponse).query).toEqual({
      destination: "Lisbon",
      checkIn: "2026-09-01",
      checkOut: "2026-09-04",
      guests: 2,
    });
  });

  it("sends each supplier its own dialect of the same question", async () => {
    const { app, alpha, beta, gamma } = await appWith({});

    await search(app).expect(200);

    // Alpha takes a city name and `guests`.
    expect(alpha.requests[0]).toContain("destination=Lisbon");
    expect(alpha.requests[0]).toContain("guests=2");
    // Beta takes a city *code* and `occupancy`.
    expect(beta.requests[0]).toContain("destination_code=LIS");
    expect(beta.requests[0]).toContain("occupancy=2");
    // Gamma takes a POST body.
    expect(gamma.requests[0]).toBe("/graphql");
  });

  it("collapses the three-way overlap into one property when grouped", async () => {
    const { app } = await appWith({});

    const res = await search(app).expect(200);
    const groups = groupByProperty((res.body as SearchResponse).options);

    // 7 offers, 4 distinct buildings.
    expect(groups).toHaveLength(4);

    const grandMeridian = groups.find((g) => g.offers.length === 3);
    expect(grandMeridian).toBeDefined();
    expect(grandMeridian!.offers.map((o) => o.supplier)).toEqual(["beta", "alpha", "gamma"]);
    // Beta is the slowest supplier and holds the best price for this property.
    expect(grandMeridian!.best.supplier).toBe("beta");
  });
});

describe("GET /api/search — supplier isolation", () => {
  it("still answers when a supplier never responds", async () => {
    const { app } = await appWith({ beta: silentHandler(), timeoutMs: 100 });

    const res = await search(app).expect(200);
    const body = res.body as SearchResponse;

    expect(body.suppliers.find((s) => s.supplier === "beta")).toMatchObject({
      status: "timeout",
      resultCount: 0,
    });
    // Alpha's 3 and Gamma's 2 still arrive.
    expect(body.options).toHaveLength(5);
    expect(body.options.some((o) => o.supplier === "beta")).toBe(false);
  });

  it("still answers when a supplier 500s with an unparseable body", async () => {
    const { app } = await appWith({ gamma: plainTextHandler(500) });

    const res = await search(app).expect(200);
    const body = res.body as SearchResponse;

    expect(body.suppliers.find((s) => s.supplier === "gamma")).toMatchObject({
      status: "error",
      resultCount: 0,
    });
    expect(body.suppliers.find((s) => s.supplier === "gamma")?.message).toMatch(/HTTP 500/);
    expect(body.options).toHaveLength(5);
  });

  it("still answers when a supplier returns a 200 full of nonsense", async () => {
    const { app } = await appWith({ alpha: jsonHandler({ unexpected: "shape" }) });

    const res = await search(app).expect(200);
    const body = res.body as SearchResponse;

    expect(body.suppliers.find((s) => s.supplier === "alpha")?.status).toBe("error");
    expect(body.options).toHaveLength(4);
  });

  it("reports partial success when a supplier sheds individual rows", async () => {
    const { app } = await appWith({
      alpha: jsonHandler({
        hotels: [{ hotelId: "BROKEN" }, ALPHA_SEARCH_PAYLOAD.hotels[0]],
      }),
    });

    const res = await search(app).expect(200);
    const alpha = (res.body as SearchResponse).suppliers.find((s) => s.supplier === "alpha");

    // Still "ok" — one bad rate must not cost the supplier its whole inventory.
    expect(alpha).toMatchObject({ status: "ok", resultCount: 1, droppedCount: 1 });
  });

  it("returns an empty but successful search when everything is down", async () => {
    const { app } = await appWith({
      alpha: plainTextHandler(503),
      beta: plainTextHandler(503),
      gamma: silentHandler(),
      timeoutMs: 100,
    });

    const res = await search(app).expect(200);
    const body = res.body as SearchResponse;

    // 200, not 500: nothing is wrong with *us*. The status block tells the
    // truth and the UI decides how to present it.
    expect(body.options).toEqual([]);
    expect(body.suppliers.map((s) => s.status)).toEqual(["error", "error", "timeout"]);
  });

  it("skips Beta entirely for a destination it has no code for", async () => {
    const { app, beta } = await appWith({});

    const res = await search(app, { destination: "Reykjavik" }).expect(200);
    const body = res.body as SearchResponse;

    // Not an error — Beta simply cannot be asked. It never gets a request.
    expect(beta.requests).toEqual([]);
    expect(body.suppliers.find((s) => s.supplier === "beta")).toMatchObject({
      status: "ok",
      resultCount: 0,
    });
  });
});

describe("GET /api/search — caching", () => {
  it("serves an identical repeat search from cache", async () => {
    const { app, alpha } = await appWith({});

    const first = await search(app).expect(200);
    const second = await search(app).expect(200);

    expect((first.body as SearchResponse).cached).toBe(false);
    expect((second.body as SearchResponse).cached).toBe(true);
    // One fan-out, not two.
    expect(alpha.requests).toHaveLength(1);
  });

  it("returns byte-identical options from cache", async () => {
    const { app } = await appWith({});

    const first = await search(app).expect(200);
    const second = await search(app).expect(200);

    expect((second.body as SearchResponse).options).toEqual((first.body as SearchResponse).options);
    expect((second.body as SearchResponse).suppliers).toEqual(
      (first.body as SearchResponse).suppliers,
    );
  });

  it("treats a different query as a different entry", async () => {
    const { app, alpha } = await appWith({});

    await search(app).expect(200);
    await search(app, { guests: "3" }).expect(200);

    expect(alpha.requests).toHaveLength(2);
  });

  it("shares one entry across spellings of the same destination", async () => {
    const { app, alpha } = await appWith({});

    await search(app, { destination: "Lisbon" }).expect(200);
    const second = await search(app, { destination: "  lisbon " }).expect(200);

    expect((second.body as SearchResponse).cached).toBe(true);
    expect(alpha.requests).toHaveLength(1);
  });

  it("refuses to cache a result set with a timed-out supplier", async () => {
    // Otherwise a single slow moment would serve degraded results for 60s.
    const { app } = await appWith({ beta: silentHandler(), timeoutMs: 100 });

    await search(app).expect(200);
    const second = await search(app).expect(200);

    expect((second.body as SearchResponse).cached).toBe(false);
  });

  it("refuses to cache a result set with a failed supplier", async () => {
    const { app } = await appWith({ gamma: plainTextHandler(500) });

    await search(app).expect(200);
    const second = await search(app).expect(200);

    expect((second.body as SearchResponse).cached).toBe(false);
  });

  it("still answers when the cache itself is broken", async () => {
    // A cache is an optimization. Redis falling over must cost latency, not
    // correctness.
    const alpha = await startFixtureServer(jsonHandler(ALPHA_SEARCH_PAYLOAD));
    const beta = await startFixtureServer(jsonHandler(BETA_SEARCH_PAYLOAD));
    const gamma = await startFixtureServer(jsonHandler(GAMMA_SEARCH_PAYLOAD));
    servers = [alpha, beta, gamma];

    const app = createApp({
      adapters: createAdapters({ alpha: alpha.url, beta: beta.url, gamma: gamma.url }),
      timeoutMs: 500,
      cache: resilientCache(
        {
          kind: "redis",
          get: () => Promise.reject(new Error("connection lost")),
          set: () => Promise.reject(new Error("connection lost")),
          close: () => Promise.resolve(),
        },
        () => undefined,
      ),
    });

    const res = await search(app).expect(200);

    expect((res.body as SearchResponse).options).toHaveLength(7);
    expect((res.body as SearchResponse).cached).toBe(false);
  });
});

describe("GET /api/search — request validation", () => {
  it("rejects a missing destination", async () => {
    const { app } = await appWith({});

    const res = await search(app, { destination: "" }).expect(400);

    expect(res.body.error).toBe("INVALID_REQUEST");
    expect(res.body.issues).toEqual([{ field: "destination", message: "is required" }]);
  });

  it("rejects a malformed date", async () => {
    const { app } = await appWith({});

    const res = await search(app, { checkIn: "01-09-2026" }).expect(400);

    expect(res.body.issues[0].field).toBe("checkIn");
  });

  it("rejects a date that does not exist", async () => {
    const { app } = await appWith({});

    const res = await search(app, { checkIn: "2026-02-31" }).expect(400);

    expect(res.body.issues[0].message).toMatch(/real calendar date/);
  });

  it("rejects a checkout that is not after checkin", async () => {
    const { app } = await appWith({});

    const res = await search(app, { checkOut: "2026-09-01" }).expect(400);

    expect(res.body.issues[0]).toEqual({
      field: "checkOut",
      message: "checkOut must be at least one night after checkIn",
    });
  });

  it("rejects an absurd party size", async () => {
    const { app } = await appWith({});

    await search(app, { guests: "0" }).expect(400);
    await search(app, { guests: "99" }).expect(400);
    await search(app, { guests: "two" }).expect(400);
  });

  it("defaults guests when omitted rather than failing", async () => {
    const { app } = await appWith({});

    const res = await request(app)
      .get("/api/search")
      .query({ destination: "Lisbon", checkIn: "2026-09-01", checkOut: "2026-09-04" })
      .expect(200);

    expect((res.body as SearchResponse).query.guests).toBe(2);
  });

  it("never reaches a supplier when the request is invalid", async () => {
    const { app, alpha } = await appWith({});

    await search(app, { destination: "" }).expect(400);

    expect(alpha.requests).toEqual([]);
  });
});
