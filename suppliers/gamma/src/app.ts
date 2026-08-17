import express, { type Express, type Request, type Response } from "express";

export const PORT = Number(process.env.SUPPLIER_GAMMA_PORT ?? 4003);

/**
 * SupplierGamma — the hostile one.
 *
 * GraphQL, deeply nested response shape, 20% of requests fail with a 500, and
 * 10% of quotes come back at a different price than the one search advertised.
 * That last behaviour is the point: price drift between search and quote is a
 * real OTA problem, and Gamma is what forces the M5 quote-revalidation path and
 * the PRICE_CHANGED response to exist.
 *
 * The GraphQL endpoint and inventory land in M2; health stays plain REST so the
 * demo's readiness check does not depend on the flaky surface.
 */
export const CONTRACT = {
  style: "graphql",
  casing: "nested-camelCase",
  priceFormat: "nested-object",
  priceBasis: "per-night",
  latencyMs: 300,
  failureRate: 0.2,
  priceDriftRate: 0.1,
} as const;

export function createApp(): Express {
  const app = express();

  app.use(express.json());

  app.get("/health", (_req: Request, res: Response) => {
    // Never fails, by design — the injected 20% failure rate applies to the
    // GraphQL endpoint only, so `npm run dev` can still tell you Gamma is up.
    res.json({ service: "supplier-gamma", status: "ok", contract: CONTRACT });
  });

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: "NOT_FOUND" });
  });

  return app;
}
