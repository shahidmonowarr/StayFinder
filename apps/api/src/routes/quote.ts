import { equalsMoney, fromMinor, nightsBetween, type Money } from "@stayfinder/shared";
import type { Request, RequestHandler, Response } from "express";
import { z } from "zod";
import {
  SupplierHotelNotFoundError,
  type SupplierAdapter,
  type SupplierQuote,
} from "../adapters/types";
import { toQuoteView, type QuoteRepository, type QuoteView } from "../db/quotes";
import { describeError } from "../errors";
import { DEFAULT_TIMEOUT_MS } from "../orchestrator/fanout";

/**
 * Quote revalidation.
 *
 * The one place in the system where degrading is the wrong answer. A search with
 * a dead supplier still returns 200 and an honest status block, because partial
 * inventory is useful. "What will this actually cost" has no partial answer — so
 * a supplier that fails here fails the request.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** `alpha:ALPHA-1042` → supplier + the supplier's own id. */
const OPTION_ID = /^(alpha|beta|gamma):(.+)$/;

export const QuoteRequestSchema = z.object({
  optionId: z.string().regex(OPTION_ID, "must look like <supplier>:<hotelId>"),
  checkIn: z.string().regex(ISO_DATE, "must be formatted YYYY-MM-DD"),
  checkOut: z.string().regex(ISO_DATE, "must be formatted YYYY-MM-DD"),
  guests: z.number().int().min(1).max(8),
  /**
   * What the client is displaying. Advisory: it decides whether we *tell* the
   * user the price moved. It never decides what gets charged — that comes from
   * the Quote row this endpoint creates.
   */
  searchedTotalMinor: z.number().int().nonnegative().optional(),
});

export interface QuoteResponse {
  status: "OK" | "PRICE_CHANGED";
  quote: QuoteView;
  /** The price the client had been showing. Present only on PRICE_CHANGED. */
  previousTotal?: Money;
}

export interface QuoteRouteOptions {
  adapters: readonly SupplierAdapter[];
  quotes: QuoteRepository;
  timeoutMs?: number;
}

export function parseOptionId(optionId: string): { supplier: string; supplierHotelId: string } {
  const match = OPTION_ID.exec(optionId);
  if (match === null) throw new Error(`Malformed option id: ${optionId}`);
  return { supplier: match[1]!, supplierHotelId: match[2]! };
}

export function createQuoteHandler(options: QuoteRouteOptions): RequestHandler {
  return async (req: Request, res: Response) => {
    const parsed = QuoteRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "INVALID_REQUEST",
        issues: parsed.error.issues.map((issue) => ({
          field: issue.path.join(".") || "request",
          message: issue.message,
        })),
      });
      return;
    }

    const request = parsed.data;
    if (nightsBetween(request.checkIn, request.checkOut) < 1) {
      res.status(400).json({
        error: "INVALID_REQUEST",
        issues: [{ field: "checkOut", message: "must be at least one night after checkIn" }],
      });
      return;
    }

    const { supplier, supplierHotelId } = parseOptionId(request.optionId);
    const adapter = options.adapters.find((candidate) => candidate.id === supplier);
    if (adapter === undefined) {
      res.status(404).json({ error: "UNKNOWN_SUPPLIER", supplier });
      return;
    }

    let live: SupplierQuote;
    try {
      live = await adapter.quote(
        {
          supplierHotelId,
          checkIn: request.checkIn,
          checkOut: request.checkOut,
          guests: request.guests,
        },
        AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      );
    } catch (error) {
      if (error instanceof SupplierHotelNotFoundError) {
        res.status(404).json({ error: "HOTEL_NOT_FOUND", optionId: request.optionId });
        return;
      }
      // 502, not 500: nothing is wrong with us, and the distinction tells the
      // client that retrying may well work.
      res.status(502).json({
        error: "SUPPLIER_UNAVAILABLE",
        supplier,
        // Unwrapped, for the same reason the status strip does it: "fetch
        // failed" tells an operator nothing.
        message: describeError(error),
      });
      return;
    }

    const previousTotal =
      request.searchedTotalMinor === undefined
        ? undefined
        : fromMinor(request.searchedTotalMinor, live.totalPrice.currency);

    // Any difference at all counts. There is no tolerance band: a price the user
    // did not see is a price the user did not agree to.
    const priceChanged =
      previousTotal !== undefined && !equalsMoney(previousTotal, live.totalPrice);

    const stored = await options.quotes.create({
      supplier: live.supplier,
      supplierHotelId: live.supplierHotelId,
      hotelName: live.hotelName,
      city: live.city,
      starRating: live.starRating,
      checkIn: request.checkIn,
      checkOut: request.checkOut,
      nights: live.nights,
      guests: request.guests,
      nightlyRate: live.nightlyRate,
      totalPrice: live.totalPrice,
      refundable: live.refundable,
      searchedTotalMinor: request.searchedTotalMinor ?? null,
      priceChanged,
    });

    const body: QuoteResponse = {
      status: priceChanged ? "PRICE_CHANGED" : "OK",
      quote: toQuoteView(stored),
      ...(priceChanged && previousTotal !== undefined ? { previousTotal } : {}),
    };

    res.json(body);
  };
}
