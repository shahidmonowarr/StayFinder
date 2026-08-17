import express, { type Express, type Request, type Response } from "express";
import { ALPHA_INVENTORY, findHotel, searchInventory, type AlphaHotel } from "./inventory";
import { defaultDelayMs, delayMiddleware } from "./latency";
import { AlphaRequestError, nightsBetween, parseSearchParams } from "./request";

export const PORT = Number(process.env.SUPPLIER_ALPHA_PORT ?? 4001);

/**
 * SupplierAlpha — the well-behaved one.
 *
 * REST, camelCase JSON, prices as integer cents, ~100ms, no injected failures,
 * and nightly rates only (never a stay total). It exists as the control case:
 * when the aggregator misbehaves, Alpha is the leg that proves the problem is
 * ours and not the supplier's.
 */
export const CONTRACT = {
  style: "rest",
  casing: "camelCase",
  priceFormat: "integer-minor-units",
  priceBasis: "per-night",
  latencyMs: 100,
  failureRate: 0,
} as const;

export interface AlphaAppOptions {
  /** Simulated latency per request. Tests pass `() => 0`. */
  delayMs?: () => number;
}

function toSearchResult(hotel: AlphaHotel) {
  return {
    hotelId: hotel.hotelId,
    name: hotel.name,
    city: hotel.city,
    starRating: hotel.starRating,
    nightlyRateCents: hotel.nightlyRateCents,
    currency: hotel.currency,
    refundable: hotel.refundable,
    maxGuests: hotel.maxGuests,
  };
}

export function createApp(options: AlphaAppOptions = {}): Express {
  const app = express();
  const delayMs = options.delayMs ?? defaultDelayMs;

  app.use(express.json());

  app.get("/health", (_req: Request, res: Response) => {
    res.json({
      service: "supplier-alpha",
      status: "ok",
      contract: CONTRACT,
      inventorySize: ALPHA_INVENTORY.length,
    });
  });

  app.use(delayMiddleware(delayMs));

  app.get("/hotels", (req: Request, res: Response) => {
    try {
      const params = parseSearchParams(req.query as Record<string, unknown>);
      const hotels = searchInventory(params.destination, params.guests).map(toSearchResult);
      res.json({ hotels, count: hotels.length });
    } catch (error) {
      if (error instanceof AlphaRequestError) {
        res.status(400).json({ error: "INVALID_REQUEST", message: error.message });
        return;
      }
      throw error;
    }
  });

  /**
   * Re-quote a single hotel. Alpha's rates are stable, so this always agrees
   * with what search advertised — it is the baseline the aggregator's
   * price-change detection is measured against.
   */
  app.get("/hotels/:hotelId/quote", (req: Request, res: Response) => {
    const hotel = findHotel(String(req.params.hotelId ?? ""));
    if (!hotel) {
      res.status(404).json({ error: "HOTEL_NOT_FOUND", message: "No such hotelId" });
      return;
    }

    try {
      const { checkIn, checkOut, guests } = parseSearchParams({
        ...(req.query as Record<string, unknown>),
        // The quote route identifies the hotel by path, so destination is not
        // part of the query — satisfy the shared validator with the hotel's own.
        destination: hotel.city,
      });

      if (hotel.maxGuests < guests) {
        res.status(409).json({ error: "OCCUPANCY_EXCEEDED", message: "Too many guests" });
        return;
      }

      // The property travels with the quote, not just the price. A consumer
      // building a booking record needs the name and rating from us rather than
      // from whatever its own client happened to send back.
      res.json({
        hotelId: hotel.hotelId,
        name: hotel.name,
        city: hotel.city,
        starRating: hotel.starRating,
        nightlyRateCents: hotel.nightlyRateCents,
        currency: hotel.currency,
        nights: nightsBetween(checkIn, checkOut),
        refundable: hotel.refundable,
      });
    } catch (error) {
      if (error instanceof AlphaRequestError) {
        res.status(400).json({ error: "INVALID_REQUEST", message: error.message });
        return;
      }
      throw error;
    }
  });

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: "NOT_FOUND" });
  });

  return app;
}
