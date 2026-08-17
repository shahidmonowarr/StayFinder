"use client";

import type { SupplierProgress, SupplierUiState } from "@/lib/search-stream";

/**
 * The fan-out, drawn as what it is.
 *
 * A parallel search under a per-supplier deadline is a distributed trace, so it
 * gets a trace's instrument: spans to scale on a shared axis, with the deadline
 * as a fixed line they either beat or hit. "Beta timed out after 1503ms" is a
 * sentence you have to assemble; a bar stopping dead at a dashed line is not.
 */

/** The deadline the API enforces per supplier. */
export const DEADLINE_MS = 1500;

/**
 * The axis runs slightly past the deadline so the line has somewhere to sit and
 * an aborted bar has visible room to stop against. Fixed rather than fitted to
 * the data: an axis that rescales as legs land would make every bar jump
 * sideways mid-search, which is precisely the motion that carries meaning here.
 */
const SCALE_MS = 1600;

const DEADLINE_PERCENT = (DEADLINE_MS / SCALE_MS) * 100;

const TICKS = [0, 400, 800, 1200];

/** Colour is never the only signal — each state also has a fill and a word. */
const BAR_STYLE: Record<SupplierUiState, string> = {
  pending: "bg-muted/35",
  slow: "bg-warn",
  ok: "bg-ok",
  timeout:
    "bg-[repeating-linear-gradient(45deg,var(--color-bad)_0_5px,color-mix(in_srgb,var(--color-bad)_60%,black)_5px_10px)]",
  error:
    "bg-[repeating-linear-gradient(45deg,var(--color-bad)_0_5px,color-mix(in_srgb,var(--color-bad)_60%,black)_5px_10px)]",
};

const STAT_TONE: Record<SupplierUiState, string> = {
  pending: "text-muted",
  slow: "text-warn",
  ok: "text-ok",
  timeout: "text-bad",
  error: "text-bad",
};

const PROTOCOL: Record<string, string> = {
  alpha: "REST · cents",
  beta: "REST · strings",
  gamma: "GraphQL · nested",
};

function percentOf(ms: number): number {
  return Math.min(100, Math.max(0, (ms / SCALE_MS) * 100));
}

/** How wide this supplier's bar is right now. */
function spanWidth(progress: SupplierProgress, elapsedMs: number): number {
  if (progress.meta !== undefined) return percentOf(progress.meta.latencyMs);
  // Still in flight: grow with the clock, but never past the deadline — the
  // API will have aborted it by then whatever this component thinks.
  return percentOf(Math.min(elapsedMs, DEADLINE_MS));
}

function statLabel(progress: SupplierProgress, elapsedMs: number, cached: boolean): string {
  const { meta, state } = progress;
  if (meta === undefined) {
    return `${Math.round(Math.min(elapsedMs, DEADLINE_MS))}ms…`;
  }
  if (meta.status === "ok") {
    // On a cache hit these durations are a recording, not a measurement — say
    // so, rather than letting the trace claim work that did not happen. The
    // rail beside this says "no suppliers were asked"; the two must agree.
    if (cached) return `${meta.latencyMs}ms when cached`;
    const dropped = meta.droppedCount > 0 ? ` · ${meta.droppedCount} dropped` : "";
    return `${meta.latencyMs}ms · ${meta.resultCount}${dropped}`;
  }
  return state === "timeout" ? `timeout · ${meta.latencyMs}ms` : `failed · ${meta.latencyMs}ms`;
}

export function SupplierTrace({
  suppliers,
  elapsedMs,
  cached,
}: {
  suppliers: SupplierProgress[];
  elapsedMs: number;
  cached: boolean;
}) {
  if (suppliers.length === 0) return null;

  return (
    <section
      aria-label="Supplier spans"
      className="rounded border border-line bg-card px-4 pt-3 pb-4"
    >
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="font-mono text-[10px] font-semibold tracking-[0.11em] text-muted uppercase">
          Supplier spans
        </h2>
        <span className="font-mono text-[11px] text-muted tabular-nums">
          {cached ? "cached · no suppliers asked" : `${Math.round(elapsedMs)}ms elapsed`}
        </span>
      </div>

      {/* Axis. Ticks are labelled once, above every bar, rather than repeated
          per row — the whole value of a shared axis is that it is shared. */}
      <div className="relative mt-3 h-4 border-b border-line" aria-hidden="true">
        {TICKS.map((tick) => (
          <span
            key={tick}
            className="absolute top-0 -translate-x-1/2 font-mono text-[9px] text-muted tabular-nums"
            style={{ left: `${percentOf(tick)}%` }}
          >
            {tick === 0 ? "0" : `${tick}ms`}
          </span>
        ))}
        <span
          className="absolute top-0 -translate-x-1/2 font-mono text-[9px] font-semibold text-bad tabular-nums"
          style={{ left: `${DEADLINE_PERCENT}%` }}
        >
          1500
        </span>
      </div>

      <ul className="mt-1">
        {suppliers.map((progress) => (
          <li
            key={progress.supplier}
            className="grid grid-cols-[72px_1fr_128px] items-center gap-3 py-1.5"
          >
            <div>
              <span className="font-mono text-[12px] font-medium">{progress.supplier}</span>
              <span className="block font-mono text-[9.5px] text-muted">
                {PROTOCOL[progress.supplier] ?? ""}
              </span>
            </div>

            <div className="relative h-5">
              <div
                className={`absolute top-1 h-3 rounded-[2px] ${BAR_STYLE[progress.state]} ${
                  progress.meta === undefined ? "" : "transition-[width] duration-200"
                } ${
                  // Faded and outlined on a cache hit: the shape is still worth
                  // seeing, but it is history rather than something that just
                  // happened, and it should not read as a live measurement.
                  cached
                    ? "opacity-30 outline-1 outline-offset-0 outline-dashed outline-muted/50"
                    : ""
                }`}
                style={{ left: 0, width: `${spanWidth(progress, elapsedMs)}%` }}
              />
              {/* The deadline, drawn on every row so a bar is always read
                  against it rather than against its neighbours. */}
              <div
                className="absolute -top-1 -bottom-1 border-l-2 border-dashed border-bad/70"
                style={{ left: `${DEADLINE_PERCENT}%` }}
                aria-hidden="true"
              />
            </div>

            <span
              className={`text-right font-mono text-[11px] tabular-nums ${STAT_TONE[progress.state]}`}
              data-testid={`span-${progress.supplier}`}
            >
              {statLabel(progress, elapsedMs, cached)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
