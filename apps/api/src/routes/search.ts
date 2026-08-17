import type { SearchResponse } from "@stayfinder/shared";
import type { Request, RequestHandler, Response } from "express";
import type { SupplierAdapter } from "../adapters/types";
import { fanOut } from "../orchestrator/fanout";
import { parseSearchRequest } from "./search-request";

export interface SearchRouteOptions {
  adapters: readonly SupplierAdapter[];
  timeoutMs?: number;
}

export function createSearchHandler(options: SearchRouteOptions): RequestHandler {
  return async (req: Request, res: Response) => {
    const parsed = parseSearchRequest(req.query);
    if (!parsed.ok) {
      res.status(400).json({ error: "INVALID_REQUEST", issues: parsed.issues });
      return;
    }

    const result = await fanOut(options.adapters, parsed.query, {
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    });

    // Always 200, even when every supplier failed. A search that found nothing
    // because the suppliers are down is a successful search with an honest
    // status block — not a server error on our side. The client decides how to
    // present it, and `suppliers[]` gives it what it needs to do that.
    const body: SearchResponse = {
      query: parsed.query,
      options: result.options,
      suppliers: result.suppliers,
      // Filled in for real by the Redis layer in M4.
      cached: false,
    };

    res.json(body);
  };
}
