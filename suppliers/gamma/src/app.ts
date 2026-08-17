import express, { type Express, type Request, type RequestHandler, type Response } from "express";
import { createYoga } from "graphql-yoga";
import {
  DEFAULT_DRIFT_RATE,
  DEFAULT_FAILURE_RATE,
  createChaos,
  parseOverride,
  type Chaos,
} from "./chaos";
import { GAMMA_INVENTORY } from "./inventory";
import { schema, type GammaContext } from "./schema";

export const PORT = Number(process.env.SUPPLIER_GAMMA_PORT ?? 4003);

/**
 * SupplierGamma — the hostile one.
 *
 * GraphQL, deeply nested response shape, 20% of requests fail with a 500, and
 * 10% of quotes come back at a different price than search advertised. That
 * last behaviour is the point: price drift between search and quote is a real
 * OTA problem, and Gamma is what forces the M5 revalidation path and the
 * PRICE_CHANGED response to exist.
 */
export const CONTRACT = {
  style: "graphql",
  casing: "nested-camelCase",
  priceFormat: "nested-object",
  priceBasis: "per-night",
  latencyMs: 300,
  failureRate: DEFAULT_FAILURE_RATE,
  priceDriftRate: DEFAULT_DRIFT_RATE,
} as const;

export interface GammaAppOptions {
  /** Injectable so tests can pin the sequence or disable chaos entirely. */
  chaos?: Chaos;
  /** Simulated latency per request. Tests pass `() => 0`. */
  delayMs?: () => number;
}

function defaultDelayMs(): number {
  return process.env.NODE_ENV === "test" ? 0 : 300;
}

export function createApp(options: GammaAppOptions = {}): Express {
  const app = express();
  const chaos = options.chaos ?? createChaos();
  const delayMs = options.delayMs ?? defaultDelayMs;

  // Health is plain REST and never fails, by design — the injected failure
  // rate applies to the GraphQL surface only, so `npm run dev` can still tell
  // you whether Gamma is up.
  app.get("/health", (_req: Request, res: Response) => {
    res.json({
      service: "supplier-gamma",
      status: "ok",
      contract: CONTRACT,
      inventorySize: GAMMA_INVENTORY.length,
    });
  });

  app.use((_req, _res, next) => {
    const ms = delayMs();
    if (ms <= 0) {
      next();
      return;
    }
    setTimeout(next, ms);
  });

  /**
   * Failure is injected at the transport layer, ahead of GraphQL, so it
   * arrives as an opaque HTTP 500 with a non-GraphQL body. That is what a
   * failing gateway in front of a supplier actually looks like, and it is
   * harsher on the consumer than a well-formed `errors` array would be.
   */
  app.use("/graphql", (req: Request, res: Response, next) => {
    const override = parseOverride(req.header("x-chaos"));
    if (chaos.shouldFail(override)) {
      res.status(500).type("text/plain").send("Internal Server Error");
      return;
    }
    next();
  });

  const yoga = createYoga({
    schema,
    graphqlEndpoint: "/graphql",
    // Landing page and introspection stay on: a reviewer poking at :4003/graphql
    // should be able to explore the schema.
    context: ({ request }): GammaContext => ({
      chaos,
      override: parseOverride(request.headers.get("x-chaos")),
    }),
  });

  // Yoga ships a fetch-style handler; Express 5's stricter handler types do not
  // recognize it, though it is call-compatible at runtime.
  app.use(yoga.graphqlEndpoint, yoga as unknown as RequestHandler);

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: "NOT_FOUND" });
  });

  return app;
}
