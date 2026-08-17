import express, { type Express, type Request, type Response } from "express";

export const PORT = Number(process.env.SUPPLIER_ALPHA_PORT ?? 4001);

/**
 * SupplierAlpha — the well-behaved one.
 *
 * REST, camelCase JSON, prices as integer cents, ~100ms, no injected failures,
 * and nightly rates only (never a stay total). It exists as the control case:
 * when the aggregator misbehaves, Alpha is the leg that proves the problem is
 * ours and not the supplier's.
 *
 * Search inventory and the /search endpoint land in M2.
 */
export const CONTRACT = {
  style: "rest",
  casing: "camelCase",
  priceFormat: "integer-minor-units",
  priceBasis: "per-night",
  latencyMs: 100,
  failureRate: 0,
} as const;

export function createApp(): Express {
  const app = express();

  app.use(express.json());

  app.get("/health", (_req: Request, res: Response) => {
    res.json({ service: "supplier-alpha", status: "ok", contract: CONTRACT });
  });

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: "NOT_FOUND" });
  });

  return app;
}
