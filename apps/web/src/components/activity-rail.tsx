"use client";

import type { SupplierProgress } from "@/lib/search-stream";
import { DEADLINE_MS } from "./supplier-trace";

/**
 * What just happened, in words.
 *
 * The trace beside this is precise and says nothing to someone who does not
 * already know what a span is. This rail is the other half: the same events,
 * narrated. "Beta gave up — the other results were kept" is the sentence that
 * turns a hatched bar into a design decision a reader can evaluate.
 *
 * Derived entirely from the supplier states, never a second source of truth.
 */

interface Entry {
  at: number;
  text: string;
  tone: "neutral" | "ok" | "bad";
}

function buildLog(suppliers: SupplierProgress[], cached: boolean): Entry[] {
  if (cached) {
    return [
      { at: 0, text: "Found this exact search in the 60-second cache", tone: "ok" },
      { at: 0, text: "No suppliers were asked", tone: "neutral" },
    ];
  }

  const entries: Entry[] = [
    { at: 0, text: `Asked ${suppliers.length} suppliers at the same time`, tone: "neutral" },
  ];

  // Completion order, which is the order a reader watched them arrive in —
  // not the order the API happens to list them.
  const settled = suppliers
    .filter(
      (progress): progress is SupplierProgress & { meta: NonNullable<SupplierProgress["meta"]> } =>
        progress.meta !== undefined,
    )
    .sort((a, b) => a.meta.latencyMs - b.meta.latencyMs);

  for (const progress of settled) {
    const { meta } = progress;
    if (meta.status === "ok") {
      entries.push({
        at: meta.latencyMs,
        text: `${progress.supplier} answered with ${meta.resultCount} ${
          meta.resultCount === 1 ? "rate" : "rates"
        }`,
        tone: "ok",
      });
    } else if (meta.status === "timeout") {
      entries.push({
        at: meta.latencyMs,
        text: `${progress.supplier} ran out of time — the other results were kept`,
        tone: "bad",
      });
    } else {
      entries.push({
        at: meta.latencyMs,
        text: `${progress.supplier} failed — the search carried on without it`,
        tone: "bad",
      });
    }
  }

  const waiting = suppliers.filter((progress) => progress.meta === undefined);
  for (const progress of waiting) {
    entries.push({
      at: DEADLINE_MS,
      text: `Still waiting on ${progress.supplier}`,
      tone: "neutral",
    });
  }

  return entries;
}

const TONE: Record<Entry["tone"], string> = {
  neutral: "text-muted",
  ok: "text-ok",
  bad: "text-bad",
};

export function ActivityRail({
  suppliers,
  cached,
  optionCount,
  propertyCount,
}: {
  suppliers: SupplierProgress[];
  cached: boolean;
  optionCount: number;
  propertyCount: number;
}) {
  if (suppliers.length === 0) return null;

  const log = buildLog(suppliers, cached);
  const answered = suppliers.filter((progress) => progress.meta?.status === "ok").length;

  return (
    <aside aria-label="What just happened" className="flex flex-col gap-5">
      <div>
        <h2 className="font-mono text-[10px] font-semibold tracking-[0.11em] text-muted uppercase">
          What just happened
        </h2>
        <ol className="mt-2.5 flex flex-col gap-1.5">
          {log.map((entry, index) => (
            <li key={`${entry.at}-${index}`} className="flex gap-2.5 text-[12px] leading-snug">
              <span className="w-11 shrink-0 font-mono text-[10.5px] text-muted tabular-nums">
                {entry.at}ms
              </span>
              <span className={TONE[entry.tone]}>{entry.text}</span>
            </li>
          ))}
        </ol>
      </div>

      <div>
        <h2 className="font-mono text-[10px] font-semibold tracking-[0.11em] text-muted uppercase">
          Result
        </h2>
        <p className="mt-2 text-[12px] leading-relaxed text-muted">
          <span className="font-medium text-ink">{propertyCount}</span>{" "}
          {propertyCount === 1 ? "property" : "properties"} from{" "}
          <span className="font-medium text-ink">{optionCount}</span>{" "}
          {optionCount === 1 ? "offer" : "offers"}, matched across{" "}
          <span className="font-medium text-ink">{answered}</span> of {suppliers.length} suppliers.
        </p>
      </div>

      <div className="border-t border-line pt-4 text-[11.5px] leading-relaxed text-muted">
        Every supplier gets 1.5 seconds. Whoever misses it is left out — the page never waits for
        the slowest one, and a supplier failing is never allowed to fail the search.
      </div>
    </aside>
  );
}
