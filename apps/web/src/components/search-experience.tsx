"use client";

import { groupByProperty, type SearchQuery } from "@stayfinder/shared";
import { useState } from "react";
import { isWaitingForAnySupplier } from "@/lib/search-stream";
import { useElapsed } from "@/lib/use-elapsed";
import { useSearchStream, type UseSearchStreamOptions } from "@/lib/use-search-stream";
import { ActivityRail } from "./activity-rail";
import { ChaosControls, type ChaosMode } from "./chaos-controls";
import { ResultsList } from "./results-list";
import { SearchForm } from "./search-form";
import { SupplierTrace } from "./supplier-trace";

/**
 * The whole search experience.
 *
 * Two readings of the same events sit side by side: the trace, which is precise
 * and says nothing to a non-engineer, and the rail, which narrates. Neither is
 * sufficient alone — that pairing is the point of the layout.
 *
 * It starts searching on mount rather than waiting for input: a visitor should
 * land on streaming results, not an empty form.
 */
export function SearchExperience({
  initialQuery,
  streamOptions,
}: {
  initialQuery: SearchQuery;
  streamOptions?: UseSearchStreamOptions;
}) {
  const [query, setQuery] = useState<SearchQuery>(initialQuery);
  const [chaos, setChaos] = useState<ChaosMode>("off");

  const state = useSearchStream(query, {
    ...streamOptions,
    // Part of the stream URL, so switching chaos re-runs the search rather than
    // leaving stale results under a changed setting.
    ...(chaos === "off" ? {} : { chaos }),
  });

  const waiting = state.phase === "streaming" && isWaitingForAnySupplier(state);
  const liveElapsed = useElapsed(state.startedAt, waiting);

  // Once the search is done the server's own figure is authoritative — the
  // client clock includes render time the API never spent.
  const elapsedMs = state.elapsedMs ?? liveElapsed;

  return (
    <div className="flex flex-col gap-5">
      <SearchForm initial={initialQuery} onSearch={setQuery} busy={waiting} />

      <ChaosControls mode={chaos} onChange={setChaos} />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="flex min-w-0 flex-col gap-5">
          <SupplierTrace suppliers={state.suppliers} elapsedMs={elapsedMs} cached={state.cached} />

          {state.error !== null && (
            <p
              role="alert"
              className="rounded border border-bad/40 bg-bad/5 px-4 py-3 text-sm text-bad"
            >
              {state.error}
            </p>
          )}

          <ResultsList
            options={state.options}
            waiting={waiting}
            apiUrl={streamOptions?.baseUrl ?? ""}
            {...(chaos === "off" ? {} : { chaos })}
          />
        </div>

        <ActivityRail
          suppliers={state.suppliers}
          cached={state.cached}
          optionCount={state.options.length}
          propertyCount={groupByProperty(state.options).length}
        />
      </div>
    </div>
  );
}
