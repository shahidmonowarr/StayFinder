"use client";

import type { SearchQuery } from "@stayfinder/shared";
import { useState } from "react";
import { isWaitingForAnySupplier } from "@/lib/search-stream";
import { useSearchStream, type UseSearchStreamOptions } from "@/lib/use-search-stream";
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
  const state = useSearchStream(query, streamOptions);

  const waiting = state.phase === "streaming" && isWaitingForAnySupplier(state);

  return (
    <div className="space-y-6">
      <SearchForm initial={initialQuery} onSearch={setQuery} busy={waiting} />

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

      <ResultsList options={state.options} waiting={waiting} />
    </div>
  );
}
