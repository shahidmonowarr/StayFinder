import {
  STREAM_EVENT,
  type StreamDoneEvent,
  type StreamLegEvent,
  type StreamMetaEvent,
} from "@stayfinder/shared";
import type { Request, RequestHandler, Response } from "express";
import type { LegOutcome } from "../orchestrator/fanout";
import { chaosContextFrom } from "./chaos";
import { legsFromCache, runSearch, type SearchServiceOptions } from "./search-service";
import { parseSearchRequest } from "./search-request";

/**
 * Progressive search over Server-Sent Events.
 *
 * Alpha answers in ~100ms and Beta can take twenty times that. Buffering until
 * every supplier resolves hands the user a blank page for the duration of the
 * slowest one, so each leg is pushed the moment it settles and the client sorts
 * as it goes.
 *
 * SSE rather than a chunked JSON stream for one practical reason beyond the
 * typed event names: `curl` renders it as readable text, so the fan-out can be
 * watched from a terminal without opening devtools.
 */

/** Idle keepalive. Rarely fires — a live fan-out finishes inside the 1500ms
 * deadline — but it is what stops a proxy from closing a stream it thinks has
 * gone quiet, and it costs nothing when unused. */
const HEARTBEAT_MS = 15_000;

export function createSearchStreamHandler(service: SearchServiceOptions): RequestHandler {
  return async (req: Request, res: Response) => {
    const parsed = parseSearchRequest(req.query);
    if (!parsed.ok) {
      // Still a plain JSON 400: the stream never opens, so there is no event to
      // report this through, and a client that gets a 400 knows not to parse it
      // as text/event-stream.
      res.status(400).json({ error: "INVALID_REQUEST", issues: parsed.issues });
      return;
    }

    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      // `no-transform` matters as much as `no-cache`: a proxy that "helpfully"
      // compresses or buffers the body defeats the entire point of streaming.
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // nginx-specific, harmless elsewhere, and the difference between a
      // progressive stream and one that arrives all at once at the end.
      "x-accel-buffering": "no",
    });
    res.flushHeaders();

    const send = (event: string, data: unknown): void => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const heartbeat = setInterval(() => {
      // A comment line: valid SSE, ignored by every client.
      res.write(": keepalive\n\n");
    }, HEARTBEAT_MS);

    // Once the client is gone there is nobody to send results to, so holding
    // supplier connections open is pure waste.
    const disconnected = new AbortController();
    res.on("close", () => {
      disconnected.abort();
    });

    const chaos = chaosContextFrom(req);

    const sendLeg = (leg: LegOutcome): void => {
      const event: StreamLegEvent = { meta: leg.meta, options: leg.options };
      send(STREAM_EVENT.leg, event);
    };

    try {
      const outcome = await runSearch(service, parsed.query, {
        // `meta` goes out as soon as the cache lookup resolves, so it can state
        // truthfully whether this response is cached rather than guessing and
        // amending later.
        onCacheResult: (cached) => {
          const meta: StreamMetaEvent = {
            query: parsed.query,
            // The real adapter list rather than a hardcoded one, so the status
            // strip reflects what this deployment actually queries.
            suppliers: service.adapters.map((adapter) => adapter.id),
            cached,
          };
          send(STREAM_EVENT.meta, meta);
        },
        onLeg: sendLeg,
        signal: disconnected.signal,
        ...(chaos === undefined ? {} : { context: chaos }),
      });

      // A cache hit produced no legs to stream, so replay it as though it had.
      // The client keeps one code path and still sees what each supplier
      // contributed — honestly labelled as cached.
      if (outcome.cached) {
        for (const leg of legsFromCache(outcome.result)) {
          sendLeg(leg);
        }
      }

      const done: StreamDoneEvent = { elapsedMs: outcome.elapsedMs };
      send(STREAM_EVENT.done, done);
    } finally {
      clearInterval(heartbeat);
      res.end();
    }
  };
}
