"use client";

import type { SearchQuery } from "@stayfinder/shared";
import { useState, type FormEvent } from "react";

/** The four cities the mock suppliers hold inventory for. */
export const DESTINATIONS = ["Lisbon", "Porto", "Barcelona", "Madrid"] as const;

const field =
  "w-full rounded-[3px] border border-line bg-card px-2.5 py-1.5 text-[13px] outline-none focus:border-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent";

const label = "mb-1 block font-mono text-[10px] tracking-[0.09em] text-muted uppercase";

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
        <span className={label}>Destination</span>
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
        <span className={label}>Check in</span>
        <input
          type="date"
          className={field}
          value={draft.checkIn}
          onChange={(event) => setDraft({ ...draft, checkIn: event.target.value })}
        />
      </label>

      <label>
        <span className={label}>Check out</span>
        <input
          type="date"
          className={field}
          value={draft.checkOut}
          onChange={(event) => setDraft({ ...draft, checkOut: event.target.value })}
        />
      </label>

      <label>
        <span className={label}>Guests</span>
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
        className="self-end rounded-[3px] bg-ink px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        {busy ? "Searching…" : "Search"}
      </button>
    </form>
  );
}
