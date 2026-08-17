"use client";

import type { SearchQuery } from "@stayfinder/shared";
import { useState, type FormEvent } from "react";

/** The four cities the mock suppliers hold inventory for. */
export const DESTINATIONS = ["Lisbon", "Porto", "Barcelona", "Madrid"] as const;

const field =
  "w-full rounded border border-line bg-white px-2.5 py-1.5 text-sm outline-none focus:border-accent";

export function SearchForm({
  initial,
  onSearch,
  busy,
}: {
  initial: SearchQuery;
  onSearch: (query: SearchQuery) => void;
  busy: boolean;
}) {
  const [draft, setDraft] = useState<SearchQuery>(initial);

  function submit(event: FormEvent) {
    event.preventDefault();
    onSearch(draft);
  }

  return (
    <form onSubmit={submit} className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      <label className="col-span-2 sm:col-span-1">
        <span className="mb-1 block text-xs text-muted">Destination</span>
        <select
          className={field}
          value={draft.destination}
          onChange={(event) => setDraft({ ...draft, destination: event.target.value })}
        >
          {DESTINATIONS.map((city) => (
            <option key={city} value={city}>
              {city}
            </option>
          ))}
        </select>
      </label>

      <label>
        <span className="mb-1 block text-xs text-muted">Check in</span>
        <input
          type="date"
          className={field}
          value={draft.checkIn}
          onChange={(event) => setDraft({ ...draft, checkIn: event.target.value })}
        />
      </label>

      <label>
        <span className="mb-1 block text-xs text-muted">Check out</span>
        <input
          type="date"
          className={field}
          value={draft.checkOut}
          onChange={(event) => setDraft({ ...draft, checkOut: event.target.value })}
        />
      </label>

      <label>
        <span className="mb-1 block text-xs text-muted">Guests</span>
        <select
          className={field}
          value={draft.guests}
          onChange={(event) => setDraft({ ...draft, guests: Number(event.target.value) })}
        >
          {[1, 2, 3, 4].map((count) => (
            <option key={count} value={count}>
              {count}
            </option>
          ))}
        </select>
      </label>

      <button
        type="submit"
        disabled={busy}
        className="self-end rounded bg-ink px-3 py-1.5 text-sm text-white disabled:opacity-50"
      >
        {busy ? "Searching…" : "Search"}
      </button>
    </form>
  );
}
