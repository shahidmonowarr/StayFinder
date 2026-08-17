import {
  BOOKING_STATUSES,
  isTerminal,
  legalTransitions,
  type BookingStatus,
} from "@stayfinder/shared";
import type { BookingEventView } from "@/lib/booking-api";

/**
 * A booking's history, reconstructed by replaying its append-only events.
 *
 * Nothing here derives state by inspecting the booking row — the row is a
 * cache of the last event. Rendering from the events is what makes the ledger
 * idea visible: the history is the truth, and the current status is a
 * consequence of it.
 */

const DESCRIPTION: Record<BookingStatus, string> = {
  PENDING: "Created, awaiting payment",
  CONFIRMED: "Payment succeeded",
  CANCELLED: "Cancelled, refund not yet issued",
  REFUNDED: "Refunded in full",
  FAILED: "Payment failed",
};

const TONE: Record<BookingStatus, string> = {
  PENDING: "bg-muted/40",
  CONFIRMED: "bg-ok",
  CANCELLED: "bg-warn",
  REFUNDED: "bg-accent",
  FAILED: "bg-bad",
};

export function BookingTimeline({
  events,
  status,
}: {
  events: BookingEventView[];
  status: BookingStatus;
}) {
  return (
    <div>
      <h2 className="font-mono text-[10px] font-semibold tracking-[0.11em] text-muted uppercase">
        State timeline
      </h2>

      <ol className="mt-3 space-y-3">
        {events.map((event, index) => (
          <li key={`${event.to}-${event.at}-${index}`} className="flex gap-3">
            <span
              aria-hidden="true"
              className={`mt-1.5 size-2 shrink-0 rounded-full ${TONE[event.to]}`}
            />
            <div className="text-[13px]">
              <p className="font-medium">
                {event.to}
                {event.transition !== null && (
                  <span className="ml-2 font-normal text-muted">via {event.transition}</span>
                )}
              </p>
              <p className="font-mono text-[10.5px] text-muted">
                {DESCRIPTION[event.to]} · {new Date(event.at).toLocaleString()}
              </p>
            </div>
          </li>
        ))}
      </ol>

      <p className="mt-4 text-[11.5px] leading-relaxed text-muted">
        {isTerminal(status) ? (
          <>This booking is in a terminal state — nothing further can happen to it.</>
        ) : (
          <>
            Permitted from here: {legalTransitions(status).join(", ")}. Anything else is rejected by
            the state machine, not by the UI.
          </>
        )}
      </p>
    </div>
  );
}

/** All five states, so a reader can see the machine and not just this booking's path. */
export function StateMachineLegend({ status }: { status: BookingStatus }) {
  return (
    <div>
      <h2 className="font-mono text-[10px] font-semibold tracking-[0.11em] text-muted uppercase">
        The machine
      </h2>
      <ul className="mt-3 space-y-1.5 font-mono text-[11px]">
        {BOOKING_STATUSES.map((candidate) => (
          <li
            key={candidate}
            className={candidate === status ? "font-medium text-ink" : "text-muted"}
          >
            <span className={`mr-2 inline-block size-1.5 rounded-full ${TONE[candidate]}`} />
            {candidate}
            {candidate === status && " ← now"}
            <span className="ml-2 opacity-70">
              {isTerminal(candidate) ? "terminal" : `→ ${legalTransitions(candidate).join(", ")}`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
