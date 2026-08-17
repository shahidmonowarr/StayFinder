import type { SearchResponse } from "@stayfinder/shared";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createAdapters, parseChaosMode } from "../adapters";
import {
  ALPHA_SEARCH_PAYLOAD,
  BETA_SEARCH_PAYLOAD,
  GAMMA_SEARCH_PAYLOAD,
} from "../adapters/fixtures";
import { createApp } from "../app";
import {
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

/** Records the `x-chaos` header each supplier was sent, if any. */
function recordingHandler(payload: unknown, seen: (string | undefined)[]): FixtureHandler {
  return (req, res) => {
    seen.push(req.headers["x-chaos"] as string | undefined);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(payload));
  };
}

async function appWithRecorders() {
  const alphaSeen: (string | undefined)[] = [];
  const betaSeen: (string | undefined)[] = [];
  const gammaSeen: (string | undefined)[] = [];

  const alpha = await startFixtureServer(recordingHandler(ALPHA_SEARCH_PAYLOAD, alphaSeen));
  const beta = await startFixtureServer(recordingHandler(BETA_SEARCH_PAYLOAD, betaSeen));
  const gamma = await startFixtureServer(recordingHandler(GAMMA_SEARCH_PAYLOAD, gammaSeen));
  servers = [alpha, beta, gamma];

  const app = createApp({
    adapters: createAdapters({ alpha: alpha.url, beta: beta.url, gamma: gamma.url }),
    timeoutMs: 500,
  });

  return { app, alphaSeen, betaSeen, gammaSeen };
}

describe("parseChaosMode", () => {
  it("accepts the three modes, case- and space-insensitively", () => {
    expect(parseChaosMode("fail")).toBe("fail");
    expect(parseChaosMode(" DRIFT ")).toBe("drift");
    expect(parseChaosMode("none")).toBe("none");
  });

  it("ignores anything else rather than passing it through", () => {
    // Nothing arbitrary reaches a supplier, whatever a caller puts in the URL.
    expect(parseChaosMode("delete-everything")).toBeUndefined();
    expect(parseChaosMode("")).toBeUndefined();
    expect(parseChaosMode(undefined)).toBeUndefined();
    expect(parseChaosMode(42)).toBeUndefined();
    expect(parseChaosMode(["fail"])).toBeUndefined();
  });
});

describe("chaos forwarding", () => {
  it("sends nothing when chaos is not requested", async () => {
    const { app, gammaSeen } = await appWithRecorders();

    await request(app).get("/api/search").query(STAY).expect(200);

    expect(gammaSeen).toEqual([undefined]);
  });

  it("forwards the mode to Gamma", async () => {
    const { app, gammaSeen } = await appWithRecorders();

    await request(app)
      .get("/api/search")
      .query({ ...STAY, chaos: "fail" })
      .expect(200);

    expect(gammaSeen).toEqual(["fail"]);
  });

  it("forwards to Gamma only — the other two have nothing to force", async () => {
    const { app, alphaSeen, betaSeen, gammaSeen } = await appWithRecorders();

    await request(app)
      .get("/api/search")
      .query({ ...STAY, chaos: "fail" })
      .expect(200);

    expect(alphaSeen).toEqual([undefined]);
    expect(betaSeen).toEqual([undefined]);
    expect(gammaSeen).toEqual(["fail"]);
  });

  it("ignores an unrecognized value instead of relaying it", async () => {
    const { app, gammaSeen } = await appWithRecorders();

    await request(app)
      .get("/api/search")
      .query({ ...STAY, chaos: "rm -rf" })
      .expect(200);

    expect(gammaSeen).toEqual([undefined]);
  });

  it("accepts the header form too, for driving it from curl", async () => {
    const { app, gammaSeen } = await appWithRecorders();

    await request(app).get("/api/search").query(STAY).set("x-chaos", "drift").expect(200);

    expect(gammaSeen).toEqual(["drift"]);
  });

  it("forwards on the stream route, where a header would be impossible", async () => {
    // `EventSource` cannot set headers, which is the whole reason chaos travels
    // as a query parameter.
    const { app, gammaSeen } = await appWithRecorders();

    await request(app)
      .get("/api/search/stream")
      .query({ ...STAY, chaos: "fail" })
      .expect(200);

    expect(gammaSeen).toEqual(["fail"]);
  });
});

describe("chaos and the cache", () => {
  it("does not serve a chaos run from a cached clean result", async () => {
    // Otherwise "break SupplierGamma" would appear to do nothing for 60 seconds
    // after any normal search.
    const { app, gammaSeen } = await appWithRecorders();

    await request(app).get("/api/search").query(STAY).expect(200);
    await request(app)
      .get("/api/search")
      .query({ ...STAY, chaos: "fail" })
      .expect(200);

    // Two real fan-outs, not one plus a cache hit.
    expect(gammaSeen).toEqual([undefined, "fail"]);
  });

  it("does not store a chaos run for the next visitor", async () => {
    const { app } = await appWithRecorders();

    await request(app)
      .get("/api/search")
      .query({ ...STAY, chaos: "none" })
      .expect(200);
    const normal = await request(app).get("/api/search").query(STAY).expect(200);

    expect((normal.body as SearchResponse).cached).toBe(false);
  });

  it("still caches an ordinary search", async () => {
    const { app } = await appWithRecorders();

    await request(app).get("/api/search").query(STAY).expect(200);
    const second = await request(app).get("/api/search").query(STAY).expect(200);

    expect((second.body as SearchResponse).cached).toBe(true);
  });
});
