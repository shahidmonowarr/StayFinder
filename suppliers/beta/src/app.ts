import express, { type Express, type Request, type Response } from "express";

export const PORT = Number(process.env.SUPPLIER_BETA_PORT ?? 4002);

/**
 * SupplierBeta — the slow one.
 *
 * REST, snake_case JSON, prices as decimal strings with a separate currency
 * field, and 800–2000ms of latency. Because its upper bound sits above the
 * aggregator's 1500ms deadline, Beta times out for real on a meaningful share
 * of searches — which is exactly what makes the timeout isolation and the
 * progressive-streaming work in M3/M4 demonstrable rather than theoretical.
 *
 * Beta also quotes stay totals, never nightly rates, so it exercises the
 * opposite side of the price normalization from Alpha.
 *
 * Search inventory and the /search endpoint land in M2.
 */
export const CONTRACT = {
  style: "rest",
  casing: "snake_case",
  priceFormat: "decimal-string",
  priceBasis: "stay-total",
  latencyMsRange: [800, 2000],
  failureRate: 0,
} as const;

export function createApp(): Express {
  const app = express();

  app.use(express.json());

  app.get("/health", (_req: Request, res: Response) => {
    // Health deliberately answers fast. Beta's latency belongs to its search
    // endpoint; a health check that also crawled would make the service look
    // down rather than slow.
    res.json({ service: "supplier-beta", status: "ok", contract: CONTRACT });
  });

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: "NOT_FOUND" });
  });

  return app;
}
