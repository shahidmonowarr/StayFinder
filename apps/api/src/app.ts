import express, { type Express, type Request, type Response } from "express";
import { SUPPLIER_IDS } from "@stayfinder/shared";

/**
 * The Express app is built separately from the listener so tests can drive it
 * in-process without binding a port.
 */
export function createApp(): Express {
  const app = express();

  app.use(express.json());

  app.get("/health", (_req: Request, res: Response) => {
    res.json({
      service: "api",
      status: "ok",
      suppliers: SUPPLIER_IDS,
      uptimeSeconds: Math.floor(process.uptime()),
    });
  });

  // Routes arriving in later milestones: /api/search (M3), /api/quote (M5),
  // /api/bookings (M5), /api/webhooks/stripe (M6).

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: "NOT_FOUND" });
  });

  return app;
}
