import { SUPPLIER_IDS } from "@stayfinder/shared";
import express, { type Express, type Request, type Response } from "express";
import { createAdapters, type SupplierAdapter } from "./adapters";
import { createMemoryCache, SEARCH_CACHE_TTL_SECONDS, type SearchCache } from "./cache";
import { corsMiddleware } from "./cors";
import { BookingRepository } from "./db/bookings";
import type { PrismaClient } from "./db/client";
import { QuoteRepository } from "./db/quotes";
import { env } from "./env";
import { createBookingHandler, createGetBookingHandler } from "./routes/bookings";
import { createQuoteHandler } from "./routes/quote";
import { createSearchHandler } from "./routes/search";
import type { SearchServiceOptions } from "./routes/search-service";
import { createSearchStreamHandler } from "./routes/search-stream";

export interface AppOptions {
  /** Injectable so tests can point at throwaway servers or fakes. */
  adapters?: readonly SupplierAdapter[];
  /**
   * Injectable so tests get isolation, and so boot can hand in a Redis-backed
   * cache without `createApp` needing to be async.
   */
  cache?: SearchCache;
  /**
   * Omitted in tests that only exercise search, so those suites need no
   * database. The quote and booking routes 503 without it rather than crashing
   * on first use.
   */
  prisma?: PrismaClient;
  /** Per-supplier deadline. Tests use a small value instead of waiting 1500ms. */
  timeoutMs?: number;
  /** Browser origin permitted to call this API. */
  webOrigin?: string;
  /** Injectable clock, so quote expiry can be tested without waiting it out. */
  now?: () => Date;
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
      database: options.prisma === undefined ? "not configured" : "connected",
      uptimeSeconds: Math.floor(process.uptime()),
    });
  });

  app.get("/api/search", createSearchHandler(service));
  app.get("/api/search/stream", createSearchStreamHandler(service));

  if (options.prisma !== undefined) {
    const quotes = new QuoteRepository(options.prisma, options.now);
    const bookings = new BookingRepository(options.prisma);

    app.post(
      "/api/quote",
      createQuoteHandler({
        adapters,
        quotes,
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      }),
    );
    app.post("/api/bookings", createBookingHandler({ quotes, bookings }));
    app.get("/api/bookings/:id", createGetBookingHandler({ quotes, bookings }));
  } else {
    // Explicit and honest: a booking endpoint that silently 404s because the
    // database was never wired up is worse than one that says so.
    for (const route of ["/api/quote", "/api/bookings"]) {
      app.all(route, (_req: Request, res: Response) => {
        res.status(503).json({ error: "DATABASE_NOT_CONFIGURED" });
      });
    }
  }

  // Routes arriving in later milestones: /api/webhooks/stripe (M6).

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: "NOT_FOUND" });
  });

  return app;
}
