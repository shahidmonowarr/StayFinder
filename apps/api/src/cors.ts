import type { RequestHandler } from "express";

/**
 * Cross-origin access for the browser client.
 *
 * The web app runs on :3000 and talks to this API on :4000 directly, so every
 * request from the page is cross-origin. That is a deliberate topology — the
 * aggregator is a real separate service, not a Next.js route handler — and CORS
 * is the cost of it. The alternative is proxying through Next's `rewrites`,
 * which would hide the API behind the frontend and make the two look like one
 * process in the network tab.
 *
 * `EventSource` cannot send custom headers and this API is read-only and
 * credential-free, so a single allowed origin and no `allow-credentials` is the
 * whole requirement. Hand-rolled rather than pulling in `cors`: the middleware
 * is shorter than its own configuration would be.
 */
export function corsMiddleware(allowedOrigin: string): RequestHandler {
  return (req, res, next) => {
    const origin = req.header("origin");

    if (origin !== undefined && (allowedOrigin === "*" || origin === allowedOrigin)) {
      res.setHeader("access-control-allow-origin", origin);
      // Without `Vary`, a shared cache could serve one origin's allow header to
      // another origin.
      res.setHeader("vary", "Origin");
      res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
      res.setHeader("access-control-allow-headers", "content-type, idempotency-key");
    }

    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }

    next();
  };
}
