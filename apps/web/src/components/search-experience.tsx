"use client";

import type { SearchQuery } from "@stayfinder/shared";
import { useState } from "react";
import { isWaitingForAnySupplier } from "@/lib/search-stream";
import { useSearchStream, type UseSearchStreamOptions } from "@/lib/use-search-stream";
import { ChaosControls, type ChaosMode } from "./chaos-controls";
import { ResultsList } from "./results-list";
import { SearchForm } from "./search-form";
import { SupplierStatusStrip } from "./supplier-status-strip";

/**
 * The whole search experience.
 *
 * It starts searching on mount rather than waiting for input: a visitor should
 * land on streaming results, not an empty form. Seeded data means there is
 * always something to show.
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

  return (
    <div className="space-y-6">
      <SearchForm initial={initialQuery} onSearch={setQuery} busy={waiting} />

      <ChaosControls mode={chaos} onChange={setChaos} />

      <SupplierStatusStrip
        suppliers={state.suppliers}
        cached={state.cached}
        elapsedMs={state.elapsedMs}
      />

      {state.error !== null && (
        <p role="alert" className="text-sm text-bad">
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
  );
}
