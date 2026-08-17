import { SUPPLIER_IDS } from "@stayfinder/shared";
import express, { type Express, type Request, type Response } from "express";
import { createAdapters, type SupplierAdapter } from "./adapters";
import { createMemoryCache, SEARCH_CACHE_TTL_SECONDS, type SearchCache } from "./cache";
import { corsMiddleware } from "./cors";
import { BookingRepository } from "./db/bookings";
import type { PrismaClient } from "./db/client";
import { LedgerRepository } from "./db/ledger";
import { QuoteRepository } from "./db/quotes";
import { env } from "./env";
import { FakePaymentProvider } from "./payments/fake";
import type { PaymentProvider } from "./payments/types";
import { createBookingHandler, createGetBookingHandler } from "./routes/bookings";
import {
  createCancelHandler,
  createDevEventHandler,
  createPaymentIntentHandler,
  createWebhookHandler,
} from "./routes/payments";
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
  /** Defaults to the fake provider, which needs no account and no network. */
  paymentProvider?: PaymentProvider;
  webhookSecret?: string;
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

  const webhookSecret = options.webhookSecret ?? env.stripeWebhookSecret;
  const provider = options.paymentProvider ?? new FakePaymentProvider({ webhookSecret });

  // Ahead of every route: the browser client is on another origin, and a
  // preflight must not fall through to the 404 handler.
  app.use(corsMiddleware(options.webOrigin ?? env.webOrigin));

  // The webhook body must stay as the exact bytes that were signed, so its raw
  // parser is mounted BEFORE the global JSON one. Reversed, `express.json`
  // consumes the stream first and the signature check compares against a
  // re-serialized object — which passes every test that posts a JS object and
  // fails against the real provider.
  //
  // `type: () => true` rather than matching `application/json`: the route only
  // ever accepts payloads whose signature we verify, so being strict about the
  // declared content type buys nothing and silently yields an unparsed body —
  // which then fails signature verification for a reason that looks nothing like
  // the actual cause.
  app.post("/api/webhooks/stripe", express.raw({ type: () => true }));
  app.use(express.json());

  app.get("/health", (_req: Request, res: Response) => {
    res.json({
      service: "api",
      status: "ok",
      suppliers: SUPPLIER_IDS,
      cache: { backend: cache.kind, ttlSeconds: SEARCH_CACHE_TTL_SECONDS },
      database: options.prisma === undefined ? "not configured" : "connected",
      payments: provider.kind,
      uptimeSeconds: Math.floor(process.uptime()),
    });
  });

  app.get("/api/search", createSearchHandler(service));
  app.get("/api/search/stream", createSearchStreamHandler(service));

  if (options.prisma !== undefined) {
    const quotes = new QuoteRepository(options.prisma, options.now);
    const bookings = new BookingRepository(options.prisma);
    const ledger = new LedgerRepository(options.prisma);
    const payments = { prisma: options.prisma, bookings, provider, webhookSecret };

    app.post(
      "/api/quote",
      createQuoteHandler({
        adapters,
        quotes,
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      }),
    );
    app.post("/api/bookings", createBookingHandler({ quotes, bookings }));
    app.get("/api/bookings/:id", createGetBookingHandler({ quotes, bookings, ledger }));

    app.post("/api/bookings/:id/payment-intent", createPaymentIntentHandler(payments));
    app.post("/api/bookings/:id/cancel", createCancelHandler(payments));
    app.post("/api/webhooks/stripe", createWebhookHandler(payments));

    if (provider.kind === "fake") {
      // Only with the fake provider: something has to play the part of the
      // provider calling back, and this signs a real payload and sends it
      // through the real webhook handler rather than bypassing either.
      app.post("/api/dev/payment-events", createDevEventHandler(payments));
    }
  } else {
    // Explicit and honest: a booking endpoint that silently 404s because the
    // database was never wired up is worse than one that says so.
    for (const route of ["/api/quote", "/api/bookings"]) {
      app.all(route, (_req: Request, res: Response) => {
        res.status(503).json({ error: "DATABASE_NOT_CONFIGURED" });
      });
    }
  }

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: "NOT_FOUND" });
  });

  return app;
}
