"use client";

import { formatMoney, type HotelOption, type PropertyGroup } from "@stayfinder/shared";
import { useState } from "react";
import { pickDisplayName } from "@/lib/display-name";
import { QuotePanel } from "./quote-panel";

/**
 * One physical property and every offer for it.
 *
 * The offers are shown inline rather than behind a disclosure. Three suppliers
 * selling the same building at three prices is the single most interesting fact
 * this product surfaces, and the previous design had it collapsed by default —
 * so the thing worth looking at was the thing you had to go looking for.
 */

function Stars({ rating }: { rating: number }) {
  if (rating === 0) {
    return <span className="font-mono text-[10px] text-muted">unrated</span>;
  }
  return (
    <span className="text-[10px] text-muted" aria-label={`${rating} star`}>
      {"★".repeat(rating)}
    </span>
  );
}

/** One supplier's price. The cheapest is marked; the rest stay legible, not greyed to death. */
function Offer({ offer, best }: { offer: HotelOption; best: boolean }) {
  return (
    <span
      data-testid={`offer-${offer.supplier}`}
      className={`inline-flex items-baseline gap-1.5 rounded-[3px] border px-1.5 py-0.5 font-mono text-[11px] tabular-nums ${
        best ? "border-ok bg-ok/10 font-medium text-ok" : "border-line bg-card text-muted"
      }`}
      title={offer.refundable ? "Free cancellation" : "Non-refundable"}
    >
      <span>{offer.supplier}</span>
      <span className={best ? "" : "text-ink"}>{formatMoney(offer.totalPrice)}</span>
      {!offer.refundable && <span aria-label="non-refundable">·nr</span>}
    </span>
  );
}

export function ResultCard({
  group,
  apiUrl,
  chaos,
}: {
  group: PropertyGroup;
  apiUrl: string;
  chaos?: string;
}) {
  const [quoting, setQuoting] = useState<HotelOption | null>(null);
  const { best, offers } = group;

  return (
    <article className="border-b border-hair last:border-b-0">
      <div className="grid grid-cols-[1fr_auto] items-start gap-4 px-4 py-3.5 sm:grid-cols-[1fr_250px_150px]">
        <div className="col-span-2 sm:col-span-1">
          <h3 className="text-[15px] font-medium">{pickDisplayName(offers)}</h3>
          <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[11.5px] text-muted">
            <span>{best.city}</span>
            <span aria-hidden="true">·</span>
            <Stars rating={best.starRating} />
            <span aria-hidden="true">·</span>
            <span>{best.refundable ? "free cancellation" : "non-refundable"}</span>
          </p>
        </div>

        <div className="col-span-2 flex flex-wrap gap-1.5 self-center sm:col-span-1">
          {offers.map((offer) => (
            <Offer key={offer.id} offer={offer} best={offer.id === best.id} />
          ))}
        </div>

        <div className="col-span-2 flex items-end justify-between gap-3 sm:col-span-1 sm:flex-col sm:items-end sm:gap-1.5">
          <div className="text-right">
            <div className="font-mono text-[17px] font-medium tabular-nums">
              {formatMoney(best.totalPrice)}
            </div>
            <div className="font-mono text-[10px] text-muted tabular-nums">
              {formatMoney(best.nightlyRate)} × {best.nights}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setQuoting(quoting === null ? best : null)}
            className="rounded-[3px] bg-accent px-3 py-1.5 text-[12.5px] font-medium text-white hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:w-full"
          >
            {quoting === null ? "Check live price" : "Close"}
          </button>
        </div>
      </div>

      {quoting !== null && (
        <div className="px-4 pb-4">
          <QuotePanel
            option={quoting}
            apiUrl={apiUrl}
            chaos={chaos}
            onClose={() => setQuoting(null)}
          />
        </div>
      )}
    </article>
  );
}
