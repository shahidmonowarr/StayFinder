"use client";

import { groupByProperty, type HotelOption } from "@stayfinder/shared";
import { ResultCard } from "./result-card";

function SkeletonCard() {
  return (
    <div className="animate-pulse border-b border-line py-5">
      <div className="flex items-baseline justify-between gap-4">
        <div className="w-full space-y-2">
          <div className="h-4 w-1/3 rounded bg-line" />
          <div className="h-3 w-1/5 rounded bg-line" />
        </div>
        <div className="w-20 shrink-0 space-y-2">
          <div className="h-4 rounded bg-line" />
          <div className="h-3 rounded bg-line" />
        </div>
      </div>
    </div>
  );
}

export function ResultsList({
  options,
  waiting,
  apiUrl = "",
}: {
  options: HotelOption[];
  /** True while at least one supplier is still outstanding. */
  waiting: boolean;
  apiUrl?: string;
}) {
  const groups = groupByProperty(options);

  if (groups.length === 0) {
    return waiting ? (
      <div data-testid="skeletons">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    ) : (
      <p className="py-10 text-sm text-muted">
        No rooms came back for this search. Every supplier either had nothing or failed — the status
        strip above says which.
      </p>
    );
  }

  return (
    <div>
      <p className="py-3 text-xs text-muted">
        {groups.length} propert{groups.length === 1 ? "y" : "ies"} · {options.length} offer
        {options.length === 1 ? "" : "s"}
        {waiting && " · still gathering"}
      </p>

      {groups.map((group) => (
        <ResultCard key={group.dedupeKey} group={group} apiUrl={apiUrl} />
      ))}

      {/* One trailing skeleton while a supplier is outstanding: the list is
          real but not yet complete, and pretending otherwise would be a lie
          the moment Beta lands with a cheaper rate. */}
      {waiting && <SkeletonCard />}
    </div>
  );
}
