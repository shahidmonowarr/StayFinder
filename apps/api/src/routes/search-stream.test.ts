import type { StreamDoneEvent, StreamLegEvent, StreamMetaEvent } from "@stayfinder/shared";
import { afterEach, describe, expect, it } from "vitest";
import { createAdapters } from "../adapters";
import {
  ALPHA_SEARCH_PAYLOAD,
  BETA_SEARCH_PAYLOAD,
  GAMMA_SEARCH_PAYLOAD,
} from "../adapters/fixtures";
import { createApp } from "../app";
import { InMemorySearchCache } from "../cache";
import {
  jsonHandler,
  plainTextHandler,
  silentHandler,
  startFixtureServer,
  type FixtureHandler,
} from "../testing/fixture-server";
import { collectSse, listenOnEphemeralPort, type CapturedEvent } from "../testing/sse";

const STAY = "destination=Lisbon&checkIn=2026-09-01&checkOut=2026-09-04&guests=2";

let teardown: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(teardown.map((fn) => fn()));
  teardown = [];
});

/** Three fake suppliers, one real app, one real listening socket. */
async function streamingApp(handlers: {
  alpha?: FixtureHandler;
  beta?: FixtureHandler;
  gamma?: FixtureHandler;
  timeoutMs?: number;
  cache?: InMemorySearchCache;
  /** Delay before each supplier answers, to make arrival order deterministic. */
  delays?: { alpha?: number; beta?: number; gamma?: number };
}) {
  const delayed = (payload: unknown, ms: number | undefined): FixtureHandler => {
    const base = jsonHandler(payload);
    if (ms === undefined) return base;
    return (req, res) => {
      setTimeout(() => base(req, res), ms);
    };
  };

  const alpha = await startFixtureServer(
    handlers.alpha ?? delayed(ALPHA_SEARCH_PAYLOAD, handlers.delays?.alpha),
  );
  const beta = await startFixtureServer(
    handlers.beta ?? delayed(BETA_SEARCH_PAYLOAD, handlers.delays?.beta),
  );
  const gamma = await startFixtureServer(
    handlers.gamma ?? delayed(GAMMA_SEARCH_PAYLOAD, handlers.delays?.gamma),
  );

  const app = createApp({
    adapters: createAdapters({ alpha: alpha.url, beta: beta.url, gamma: gamma.url }),
    timeoutMs: handlers.timeoutMs ?? 500,
    ...(handlers.cache === undefined ? {} : { cache: handlers.cache }),
  });
  const listening = await listenOnEphemeralPort(app);

  teardown = [alpha.close, beta.close, gamma.close, listening.close];
  return { url: listening.url, alpha, beta, gamma };
}

function only(events: CapturedEvent[], event: string): CapturedEvent[] {
  return events.filter((candidate) => candidate.event === event);
}

describe("GET /api/search/stream — protocol", () => {
  it("emits meta, one leg per supplier, then done", async () => {
    const { url } = await streamingApp({});

    const events = await collectSse(`${url}/api/search/stream?${STAY}`);

    expect(events.map((event) => event.event)).toEqual(["meta", "leg", "leg", "leg", "done"]);
  });

  it("announces every supplier up front so the strip can render as pending", async () => {
    const { url } = await streamingApp({});

    const events = await collectSse(`${url}/api/search/stream?${STAY}`);
    const meta = events[0]?.data as StreamMetaEvent;

    expect(meta.suppliers).toEqual(["alpha", "beta", "gamma"]);
    expect(meta.cached).toBe(false);
    expect(meta.query.destination).toBe("Lisbon");
  });

  it("carries each supplier's status and its options in the same event", async () => {
    const { url } = await streamingApp({});

    const events = await collectSse(`${url}/api/search/stream?${STAY}`);
    const legs = only(events, "leg").map((event) => event.data as StreamLegEvent);

    for (const leg of legs) {
      expect(leg.meta.resultCount).toBe(leg.options.length);
    }
    expect(legs.flatMap((leg) => leg.options)).toHaveLength(7);
  });

  it("reports total elapsed time on done", async () => {
    const { url } = await streamingApp({});

    const events = await collectSse(`${url}/api/search/stream?${STAY}`);
    const done = events.at(-1)?.data as StreamDoneEvent;

    expect(done.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it("serves the correct content type and defeats intermediary buffering", async () => {
    const { url } = await streamingApp({});

    const response = await fetch(`${url}/api/search/stream?${STAY}`);
    // Read the body so the connection closes cleanly.
    await response.text();

    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("cache-control")).toContain("no-transform");
    expect(response.headers.get("x-accel-buffering")).toBe("no");
  });
});

describe("GET /api/search/stream — progressiveness", () => {
  it("delivers a fast supplier's results before a slow one has answered", async () => {
    // This is the entire point of the milestone: if these arrived together the
    // stream would be a buffered response wearing a costume.
    const { url } = await streamingApp({ delays: { beta: 250 }, timeoutMs: 1000 });

    const events = await collectSse(`${url}/api/search/stream?${STAY}`);
    const legs = only(events, "leg");
    const arrivalOrder = legs.map((leg) => (leg.data as StreamLegEvent).meta.supplier);

    expect(arrivalOrder.at(-1)).toBe("beta");
    const alphaAt = legs.find((l) => (l.data as StreamLegEvent).meta.supplier === "alpha")!.atMs;
    const betaAt = legs.find((l) => (l.data as StreamLegEvent).meta.supplier === "beta")!.atMs;
    expect(betaAt - alphaAt).toBeGreaterThan(150);
  });

  it("emits legs in completion order, not adapter order", async () => {
    const { url } = await streamingApp({ delays: { alpha: 200 }, timeoutMs: 1000 });

    const events = await collectSse(`${url}/api/search/stream?${STAY}`);
    const order = only(events, "leg").map((leg) => (leg.data as StreamLegEvent).meta.supplier);

    expect(order.at(-1)).toBe("alpha");
  });
});

describe("GET /api/search/stream — failure", () => {
  it("streams a timed-out supplier as its own leg and still finishes", async () => {
    const { url } = await streamingApp({ beta: silentHandler(), timeoutMs: 150 });

    const events = await collectSse(`${url}/api/search/stream?${STAY}`);
    const legs = only(events, "leg").map((event) => event.data as StreamLegEvent);
    const beta = legs.find((leg) => leg.meta.supplier === "beta");

    expect(beta?.meta.status).toBe("timeout");
    expect(beta?.options).toEqual([]);
    expect(events.at(-1)?.event).toBe("done");
  });

  it("streams a failed supplier without breaking the stream", async () => {
    const { url } = await streamingApp({ gamma: plainTextHandler(500) });

    const events = await collectSse(`${url}/api/search/stream?${STAY}`);
    const legs = only(events, "leg").map((event) => event.data as StreamLegEvent);

    expect(legs.find((leg) => leg.meta.supplier === "gamma")?.meta.status).toBe("error");
    expect(events.at(-1)?.event).toBe("done");
  });

  it("rejects an invalid query as JSON, without opening a stream", async () => {
    const { url } = await streamingApp({});

    const response = await fetch(`${url}/api/search/stream?destination=&checkIn=2026-09-01`);
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(body.error).toBe("INVALID_REQUEST");
  });

  it("cancels in-flight supplier requests when the client hangs up", async () => {
    const { url, beta } = await streamingApp({ beta: silentHandler(), timeoutMs: 5000 });
    const controller = new AbortController();

    // Abort as soon as Alpha's leg lands — Beta is still hanging at that point.
    const collected = collectSse(`${url}/api/search/stream?${STAY}`, {
      signal: controller.signal,
      onEvent: (event) => {
        if (event.event === "leg") controller.abort();
      },
    }).catch(() => undefined);

    await collected;
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Beta's socket was closed rather than left open until the 5s deadline.
    expect(beta.aborted.length).toBeGreaterThan(0);
  });
});

describe("GET /api/search/stream — caching", () => {
  it("replays a cache hit through the same protocol", async () => {
    const cache = new InMemorySearchCache();
    const { url } = await streamingApp({ cache });

    const first = await collectSse(`${url}/api/search/stream?${STAY}`);
    const second = await collectSse(`${url}/api/search/stream?${STAY}`);

    expect((first[0]?.data as StreamMetaEvent).cached).toBe(false);
    expect((second[0]?.data as StreamMetaEvent).cached).toBe(true);
    // Same event sequence either way, so the client needs one code path.
    expect(second.map((event) => event.event)).toEqual(first.map((event) => event.event));
  });

  it("serves the same options and supplier metadata from cache", async () => {
    const cache = new InMemorySearchCache();
    const { url } = await streamingApp({ cache });

    const first = await collectSse(`${url}/api/search/stream?${STAY}`);
    const second = await collectSse(`${url}/api/search/stream?${STAY}`);

    const optionsOf = (events: CapturedEvent[]) =>
      events
        .filter((event) => event.event === "leg")
        .flatMap((event) => (event.data as StreamLegEvent).options.map((option) => option.id));

    expect(optionsOf(second).sort()).toEqual(optionsOf(first).sort());
  });

  it("does not query the suppliers again on a hit", async () => {
    const cache = new InMemorySearchCache();
    const { url, alpha } = await streamingApp({ cache });

    await collectSse(`${url}/api/search/stream?${STAY}`);
    const afterFirst = alpha.requests.length;
    await collectSse(`${url}/api/search/stream?${STAY}`);

    expect(alpha.requests.length).toBe(afterFirst);
  });
});
