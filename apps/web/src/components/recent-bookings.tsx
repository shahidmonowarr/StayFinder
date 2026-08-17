import { formatMoney, type BookingStatus, type Money } from "@stayfinder/shared";

/**
 * A short list of recent bookings.
 *
 * This exists because the demo had a dead end: a booking was reachable only from
 * the panel that created it, so navigating away lost it for good. Guest emails
 * are not returned by the API for this list — identifying a booking does not
 * need one, and the endpoint has no authentication.
 */

export interface RecentBooking {
  id: string;
  status: BookingStatus;
  hotelName: string;
  city: string;
  checkIn: string;
  nights: number;
  total: Money;
  guestName: string;
}

const TONE: Record<BookingStatus, string> = {
  PENDING: "text-muted",
  CONFIRMED: "text-ok",
  CANCELLED: "text-warn",
  REFUNDED: "text-accent",
  FAILED: "text-bad",
};

export function RecentBookings({ bookings }: { bookings: RecentBooking[] }) {
  if (bookings.length === 0) return null;

  return (
    <section className="mt-14">
      <h2 className="font-mono text-[10px] font-semibold tracking-[0.11em] text-muted uppercase">
        Recent bookings
      </h2>

      <ul className="mt-3 overflow-hidden rounded border border-line bg-card">
        {bookings.map((booking) => (
          <li key={booking.id}>
            <a
              href={`/bookings/${booking.id}`}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-hair px-4 py-2.5 text-[13px] last:border-b-0 hover:bg-surface focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
            >
              <span className="font-medium">{booking.hotelName}</span>
              <span className="font-mono text-[10.5px] text-muted">
                {booking.city} · {booking.checkIn} · {booking.nights} nights
              </span>
              <span className={`ml-auto font-mono text-[10.5px] ${TONE[booking.status]}`}>
                {booking.status}
              </span>
              <span className="w-20 text-right font-mono tabular-nums">
                {formatMoney(booking.total)}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
