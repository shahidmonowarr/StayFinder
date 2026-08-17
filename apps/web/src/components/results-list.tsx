"use client";

import { groupByProperty, type HotelOption } from "@stayfinder/shared";
import { ResultCard } from "./result-card";

function SkeletonRow() {
  return (
    <div className="animate-pulse border-b border-hair px-4 py-3.5 last:border-b-0">
      <div className="grid grid-cols-[1fr_250px_150px] items-center gap-4">
        <div className="space-y-1.5">
          <div className="h-3.5 w-2/5 rounded bg-line" />
          <div className="h-2.5 w-1/4 rounded bg-line" />
        </div>
        <div className="flex gap-1.5">
          <div className="h-5 w-24 rounded-[3px] bg-line" />
          <div className="h-5 w-24 rounded-[3px] bg-line" />
        </div>
        <div className="ml-auto h-8 w-24 rounded bg-line" />
      </div>
    </div>
  );
}

export function ResultsList({
  options,
  waiting,
  apiUrl = "",
  chaos,
}: {
  options: HotelOption[];
  /** True while at least one supplier is still outstanding. */
  waiting: boolean;
  apiUrl?: string;
  chaos?: string;
}) {
  const groups = groupByProperty(options);

  if (groups.length === 0) {
    return waiting ? (
      <div data-testid="skeletons" className="overflow-hidden rounded border border-line bg-card">
        <SkeletonRow />
        <SkeletonRow />
        <SkeletonRow />
      </div>
    ) : (
      <div className="rounded border border-line bg-card px-4 py-10 text-center">
        <p className="text-sm text-muted">
          No rooms came back. Every supplier either had nothing or failed — the spans above say
          which.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded border border-line bg-card">
      <div className="flex items-baseline justify-between border-b border-line px-4 py-2">
        <h2 className="font-mono text-[10px] font-semibold tracking-[0.11em] text-muted uppercase">
          Results
        </h2>
        <span className="font-mono text-[11px] text-muted tabular-nums">
          {groups.length} {groups.length === 1 ? "property" : "properties"} · {options.length}{" "}
          {options.length === 1 ? "offer" : "offers"}
          {waiting && " · still gathering"}
        </span>
      </div>

      {groups.map((group) => (
        <ResultCard key={group.dedupeKey} group={group} apiUrl={apiUrl} chaos={chaos} />
      ))}

      {/* One trailing skeleton while a supplier is outstanding: the list is real
          but not yet complete, and pretending otherwise would be a lie the
          moment a cheaper late supplier lands. */}
      {waiting && <SkeletonRow />}
    </div>
  );
}
