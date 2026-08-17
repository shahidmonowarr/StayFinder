import express, { type Express, type Request, type Response } from "express";
import { BETA_INVENTORY, findHotel, searchInventory, type BetaHotel } from "./inventory";
import { MAX_LATENCY_MS, MIN_LATENCY_MS, defaultDelayMs, delayMiddleware } from "./latency";
import { BetaRequestError, parseSearchParams, parseStayParams, toDecimalString } from "./request";

export const PORT = Number(process.env.SUPPLIER_BETA_PORT ?? 4002);

/**
 * SupplierBeta — the slow one.
 *
 * REST, snake_case JSON, prices as decimal strings with a separate currency
 * field, and 800–2000ms of latency. Beta quotes stay totals and never nightly
 * rates, so it exercises the opposite side of price normalization from Alpha.
 */
export const CONTRACT = {
  style: "rest",
  casing: "snake_case",
  priceFormat: "decimal-string",
  priceBasis: "stay-total",
  latencyMsRange: [MIN_LATENCY_MS, MAX_LATENCY_MS],
  failureRate: 0,
} as const;

export interface BetaAppOptions {
  /** Simulated latency per request. Tests pass `() => 0`. */
  delayMs?: () => number;
}

/**
 * `category` is omitted entirely for unclassified properties rather than sent
 * as null — consumers must handle an absent key, not a null value.
 */
function toSearchResult(hotel: BetaHotel, nights: number) {
  const result: Record<string, unknown> = {
    hotel_id: hotel.hotel_id,
    hotel_name: hotel.hotel_name,
    city_name: hotel.city_name,
    total_price: toDecimalString(hotel.nightly_base_cents * nights),
    currency: hotel.currency,
    cancellation_policy: hotel.cancellation_policy,
    max_occupancy: hotel.max_occupancy,
    nights,
  };
  if (hotel.category !== undefined) {
    result.category = hotel.category;
  }
  return result;
}

function sendRequestError(res: Response, error: BetaRequestError): void {
  res.status(400).json({ error_code: error.code, error_message: error.message });
}

export function createApp(options: BetaAppOptions = {}): Express {
  const app = express();
  const delayMs = options.delayMs ?? defaultDelayMs;

  app.use(express.json());

  // Health answers immediately. Beta's latency belongs to its availability
  // endpoints; a health check that also crawled would make the service look
  // down rather than slow.
  app.get("/health", (_req: Request, res: Response) => {
    res.json({
      service: "supplier-beta",
      status: "ok",
      contract: CONTRACT,
      inventory_size: BETA_INVENTORY.length,
    });
  });

  app.use(delayMiddleware(delayMs));

  app.get("/v1/availability", (req: Request, res: Response) => {
    try {
      const params = parseSearchParams(req.query as Record<string, unknown>);
      const results = searchInventory(params.destination_code, params.occupancy).map((hotel) =>
        toSearchResult(hotel, params.nights),
      );
      res.json({ results, result_count: results.length });
    } catch (error) {
      if (error instanceof BetaRequestError) {
        sendRequestError(res, error);
        return;
      }
      throw error;
    }
  });

  /** Beta's rates are stable — a re-quote always matches search. */
  app.get("/v1/availability/:hotel_id/price", (req: Request, res: Response) => {
    const hotel = findHotel(String(req.params.hotel_id ?? ""));
    if (!hotel) {
      res.status(404).json({ error_code: "unknown_hotel", error_message: "No such hotel_id" });
      return;
    }

    try {
      const stay = parseStayParams(req.query as Record<string, unknown>);
      if (hotel.max_occupancy < stay.occupancy) {
        res.status(409).json({
          error_code: "occupancy_exceeded",
          error_message: "Requested occupancy exceeds max_occupancy",
        });
        return;
      }

      // Beta omits `category` here exactly as it does in availability, so a
      // consumer cannot rely on a quote to fill a gap search left.
      const quote: Record<string, unknown> = {
        hotel_id: hotel.hotel_id,
        hotel_name: hotel.hotel_name,
        city_name: hotel.city_name,
        total_price: toDecimalString(hotel.nightly_base_cents * stay.nights),
        currency: hotel.currency,
        nights: stay.nights,
        cancellation_policy: hotel.cancellation_policy,
      };
      if (hotel.category !== undefined) {
        quote.category = hotel.category;
      }
      res.json(quote);
    } catch (error) {
      if (error instanceof BetaRequestError) {
        sendRequestError(res, error);
        return;
      }
      throw error;
    }
  });

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error_code: "not_found", error_message: "Unknown endpoint" });
  });

  return app;
}
