"use client";

import { formatMoney, type HotelOption, type PropertyGroup } from "@stayfinder/shared";
import { useState } from "react";
import { pickDisplayName } from "@/lib/display-name";
import { QuotePanel } from "./quote-panel";

function Stars({ rating }: { rating: number }) {
  if (rating === 0) return <span className="text-xs text-muted">unrated</span>;
  return (
    <span className="text-xs text-muted" aria-label={`${rating} star`}>
      {"★".repeat(rating)}
    </span>
  );
}

/**
 * One physical property, however many suppliers sell it.
 *
 * The headline is the cheapest offer, but the others stay reachable — they are
 * not noise. The Grand Meridian is cheaper from one supplier and refundable
 * from another, and only the user can say which of those they want.
 */
export function ResultCard({
  group,
  apiUrl,
  chaos,
}: {
  group: PropertyGroup;
  apiUrl: string;
  chaos?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  // Which offer is being quoted, if any. Held per card rather than globally so
  // two properties can be inspected without one closing the other.
  const [quoting, setQuoting] = useState<HotelOption | null>(null);
  const { best, offers } = group;
  const alternatives = offers.length - 1;

  return (
    <article className="border-b border-line py-5">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h3 className="font-medium">{pickDisplayName(offers)}</h3>
          <p className="mt-1 flex items-center gap-2 text-xs text-muted">
            <span>{best.city}</span>
            <span aria-hidden="true">·</span>
            <Stars rating={best.starRating} />
          </p>
        </div>

        <div className="shrink-0 text-right">
          <p className="font-medium tabular-nums">{formatMoney(best.totalPrice)}</p>
          <p className="text-xs text-muted tabular-nums">
            {formatMoney(best.nightlyRate)} × {best.nights} nights
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded border border-line px-1.5 py-0.5 capitalize">{best.supplier}</span>
        <span className={best.refundable ? "text-ok" : "text-muted"}>
          {best.refundable ? "Free cancellation" : "Non-refundable"}
        </span>

        <button
          type="button"
          onClick={() => setQuoting(quoting === null ? best : null)}
          className="ml-auto rounded border border-line px-2 py-0.5 hover:border-accent"
        >
          {quoting === null ? "Check price" : "Cancel"}
        </button>

        {alternatives > 0 && (
          <button
            type="button"
            onClick={() => setExpanded((open) => !open)}
            className="text-accent underline underline-offset-2"
          >
            {expanded
              ? "Hide"
              : `Also from ${alternatives} other supplier${alternatives === 1 ? "" : "s"}`}
          </button>
        )}
      </div>

      {expanded && alternatives > 0 && (
        <ul className="mt-3 space-y-1.5 border-l border-line pl-3">
          {offers.slice(1).map((offer) => (
            <li key={offer.id} className="flex items-center gap-3 text-xs text-muted">
              <span className="w-16 capitalize">{offer.supplier}</span>
              <span className="tabular-nums">{formatMoney(offer.totalPrice)}</span>
              <span>{offer.refundable ? "refundable" : "non-refundable"}</span>
              <span className="truncate italic opacity-70">“{offer.name}”</span>
            </li>
          ))}
        </ul>
      )}

      {quoting !== null && (
        <QuotePanel
          option={quoting}
          apiUrl={apiUrl}
          chaos={chaos}
          onClose={() => setQuoting(null)}
        />
      )}
    </article>
  );
}
