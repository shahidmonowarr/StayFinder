import type { SearchResponse } from "@stayfinder/shared";
import type { Request, RequestHandler, Response } from "express";
import { chaosContextFrom } from "./chaos";
import { runSearch, type SearchServiceOptions } from "./search-service";
import { parseSearchRequest } from "./search-request";

/**
 * The buffered search. Kept alongside the SSE route because not every consumer
 * wants a stream — a server-to-server caller wants one JSON body, and a cache
 * hit is one anyway.
 */
export function createSearchHandler(service: SearchServiceOptions): RequestHandler {
  return async (req: Request, res: Response) => {
    const parsed = parseSearchRequest(req.query);
    if (!parsed.ok) {
      res.status(400).json({ error: "INVALID_REQUEST", issues: parsed.issues });
      return;
    }

    const context = chaosContextFrom(req);
    const outcome = await runSearch(service, parsed.query, {
      ...(context === undefined ? {} : { context }),
    });

    // Always 200, even when every supplier failed. A search that found nothing
    // because the suppliers are down is a successful search with an honest
    // status block — not a server error on our side. The client decides how to
    // present it, and `suppliers[]` gives it what it needs to do that.
    const body: SearchResponse = {
      query: parsed.query,
      options: outcome.result.options,
      suppliers: outcome.result.suppliers,
      cached: outcome.cached,
    };

    res.json(body);
  };
}
