"use client";

import { STREAM_EVENT, type SearchQuery } from "@stayfinder/shared";
import { useEffect, useReducer, useRef } from "react";
import {
  initialSearchStreamState,
  searchStreamReducer,
  type SearchStreamState,
} from "./search-stream";

/**
 * Subscribe to `/api/search/stream` and accumulate the result.
 *
 * The minimum an EventSource needs to satisfy. Declared as an interface, and
 * the constructor injected, because jsdom has no EventSource — so the hook's
 * lifecycle can be tested with a fake rather than left uncovered.
 */
export interface EventSourceLike {
  addEventListener(type: string, listener: (event: { data?: string }) => void): void;
  close(): void;
}

export type EventSourceFactory = (url: string) => EventSourceLike;

/** A supplier still outstanding after this long is shown as slow. */
export const SLOW_AFTER_MS = 800;

const defaultFactory: EventSourceFactory = (url) => new EventSource(url);

export interface UseSearchStreamOptions {
  baseUrl?: string;
  eventSourceFactory?: EventSourceFactory;
  slowAfterMs?: number;
  /**
   * Forced supplier behaviour. Part of the URL rather than a header because
   * `EventSource` cannot set headers — and because being in the URL means a
   * change to it re-runs the search, which is exactly what should happen.
   */
  chaos?: string;
}

export function searchStreamUrl(baseUrl: string, query: SearchQuery, chaos?: string): string {
  const params = new URLSearchParams({
    destination: query.destination,
    checkIn: query.checkIn,
    checkOut: query.checkOut,
    guests: String(query.guests),
  });
  if (chaos !== undefined && chaos !== "") params.set("chaos", chaos);
  return `${baseUrl}/api/search/stream?${params.toString()}`;
}

export function useSearchStream(
  query: SearchQuery | null,
  options: UseSearchStreamOptions = {},
): SearchStreamState {
  const [state, dispatch] = useReducer(searchStreamReducer, initialSearchStreamState);

  const baseUrl = options.baseUrl ?? "";
  const slowAfterMs = options.slowAfterMs ?? SLOW_AFTER_MS;
  const chaos = options.chaos;

  /**
   * The factory is held in a ref rather than listed as a dependency.
   *
   * It is a *tool the effect uses*, not a reason to re-subscribe. Depending on
   * its identity means a caller passing an inline lambda — the obvious thing to
   * write — re-opens the stream on every render, and since each open dispatches
   * `start`, that render loop never terminates. Which is exactly what happened
   * the first time this was written.
   */
  const factoryRef = useRef(options.eventSourceFactory ?? defaultFactory);
  useEffect(() => {
    factoryRef.current = options.eventSourceFactory ?? defaultFactory;
  }, [options.eventSourceFactory]);

  // Destructured so the effect depends on the query's *values*, not on the
  // identity of an object the caller may rebuild on every render.
  const destination = query?.destination;
  const checkIn = query?.checkIn;
  const checkOut = query?.checkOut;
  const guests = query?.guests;

  useEffect(() => {
    if (
      destination === undefined ||
      checkIn === undefined ||
      checkOut === undefined ||
      guests === undefined
    ) {
      return;
    }

    dispatch({ type: "start" });

    const source = factoryRef.current(
      searchStreamUrl(baseUrl, { destination, checkIn, checkOut, guests }, chaos),
    );

    let closed = false;
    const close = (): void => {
      if (closed) return;
      closed = true;
      source.close();
    };

    const on = (type: string, handle: (data: string) => void): void => {
      source.addEventListener(type, (event) => {
        if (typeof event.data === "string") handle(event.data);
      });
    };

    on(STREAM_EVENT.meta, (data) => {
      dispatch({ type: STREAM_EVENT.meta, event: JSON.parse(data) });
    });
    on(STREAM_EVENT.leg, (data) => {
      dispatch({ type: STREAM_EVENT.leg, event: JSON.parse(data) });
    });

    source.addEventListener(STREAM_EVENT.done, (event) => {
      if (typeof event.data === "string") {
        dispatch({ type: STREAM_EVENT.done, event: JSON.parse(event.data) });
      }
      // Closing here is mandatory, not tidiness: EventSource reconnects
      // automatically, so a stream left open after `done` would silently re-run
      // the entire search — and keep re-running it.
      close();
    });

    source.addEventListener("error", () => {
      // Fires only if the connection breaks before `done`, since `done` closes.
      if (closed) return;
      dispatch({ type: "failed", message: "Lost connection to the search service" });
      close();
    });

    const slowTimer = setTimeout(() => {
      dispatch({ type: "slow" });
    }, slowAfterMs);

    return () => {
      clearTimeout(slowTimer);
      close();
    };
    // Only values that genuinely define *which* search this is. Anything else
    // in here re-opens the stream and re-runs the fan-out.
  }, [destination, checkIn, checkOut, guests, baseUrl, slowAfterMs, chaos]);

  return state;
}
