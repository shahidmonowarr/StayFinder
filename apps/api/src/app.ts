import { SUPPLIER_IDS } from "@stayfinder/shared";
import express, { type Express, type Request, type Response } from "express";
import { createAdapters, type SupplierAdapter } from "./adapters";
import { env } from "./env";
import { createSearchHandler } from "./routes/search";

export interface AppOptions {
  /** Injectable so tests can point at throwaway servers or fakes. */
  adapters?: readonly SupplierAdapter[];
  /** Per-supplier deadline. Tests use a small value instead of waiting 1500ms. */
  timeoutMs?: number;
}

/**
 * The Express app is built separately from the listener so tests can drive it
 * in-process without binding a port.
 */
export function createApp(options: AppOptions = {}): Express {
  const app = express();
  const adapters = options.adapters ?? createAdapters(env.suppliers);

  app.use(express.json());

  app.get("/health", (_req: Request, res: Response) => {
    res.json({
      service: "api",
      status: "ok",
      suppliers: SUPPLIER_IDS,
      uptimeSeconds: Math.floor(process.uptime()),
    });
  });

  app.get(
    "/api/search",
    createSearchHandler({
      adapters,
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    }),
  );

  // Routes arriving in later milestones: /api/quote (M5), /api/bookings (M5),
  // /api/webhooks/stripe (M6).

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: "NOT_FOUND" });
  });

  return app;
}
