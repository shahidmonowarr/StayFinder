"use client";

import { useEffect, useState } from "react";

/**
 * Milliseconds since a search began, ticking while it runs.
 *
 * This exists so an in-flight supplier has a *width*. `SupplierMeta.latencyMs`
 * only arrives once a leg settles, so without a clock a pending supplier would
 * be an empty row that suddenly snaps to full length — which shows the result
 * of the deadline but never the deadline doing anything. A bar that crawls
 * toward the line and gets cut off is the whole point.
 *
 * ~60ms rather than an animation frame: the bar moves about half a pixel per
 * frame at this scale, so 16ms of work buys nothing a viewer can see.
 */
const TICK_MS = 60;

export function useElapsed(startedAt: number | null, running: boolean): number {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (startedAt === null) {
      setElapsed(0);
      return;
    }

    // Set immediately as well as on an interval, so a search that finishes
    // faster than one tick still reports a real duration rather than zero.
    setElapsed(Math.max(0, performance.now() - startedAt));

    if (!running) return;

    const timer = setInterval(() => {
      setElapsed(Math.max(0, performance.now() - startedAt));
    }, TICK_MS);

    return () => {
      clearInterval(timer);
    };
  }, [startedAt, running]);

  return elapsed;
}
