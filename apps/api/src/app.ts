import { SUPPLIER_IDS } from "@stayfinder/shared";
import express, { type Express, type Request, type Response } from "express";
import { createAdapters, type SupplierAdapter } from "./adapters";
import { createMemoryCache, SEARCH_CACHE_TTL_SECONDS, type SearchCache } from "./cache";
import { corsMiddleware } from "./cors";
import { env } from "./env";
import { createSearchHandler } from "./routes/search";
import { createSearchStreamHandler } from "./routes/search-stream";
import type { SearchServiceOptions } from "./routes/search-service";

export interface AppOptions {
  /** Injectable so tests can point at throwaway servers or fakes. */
  adapters?: readonly SupplierAdapter[];
  /**
   * Injectable so tests get isolation, and so boot can hand in a Redis-backed
   * cache without `createApp` needing to be async.
   */
  cache?: SearchCache;
  /** Per-supplier deadline. Tests use a small value instead of waiting 1500ms. */
  timeoutMs?: number;
  /** Browser origin permitted to call this API. */
  webOrigin?: string;
}

/**
 * The Express app is built separately from the listener so tests can drive it
 * in-process without binding a port.
 */
export function createApp(options: AppOptions = {}): Express {
  const app = express();
  const adapters = options.adapters ?? createAdapters(env.suppliers);
  const cache = options.cache ?? createMemoryCache();

  const service: SearchServiceOptions = {
    adapters,
    cache,
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  };

  // Ahead of every route: the browser client is on another origin, and a
  // preflight must not fall through to the 404 handler.
  app.use(corsMiddleware(options.webOrigin ?? env.webOrigin));
  app.use(express.json());

  app.get("/health", (_req: Request, res: Response) => {
    res.json({
      service: "api",
      status: "ok",
      suppliers: SUPPLIER_IDS,
      cache: { backend: cache.kind, ttlSeconds: SEARCH_CACHE_TTL_SECONDS },
      uptimeSeconds: Math.floor(process.uptime()),
    });
  });

  app.get("/api/search", createSearchHandler(service));
  app.get("/api/search/stream", createSearchStreamHandler(service));

  // Routes arriving in later milestones: /api/quote (M5), /api/bookings (M5),
  // /api/webhooks/stripe (M6).

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: "NOT_FOUND" });
  });

  return app;
}
