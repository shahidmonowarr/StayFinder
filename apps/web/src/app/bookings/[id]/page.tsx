import { formatMoney } from "@stayfinder/shared";
import { notFound } from "next/navigation";
import { BookingTimeline, StateMachineLegend } from "@/components/booking-timeline";
import { LedgerTable } from "@/components/ledger-table";
import { PaymentPanel } from "@/components/payment-panel";
import type { BookingDetail } from "@/lib/booking-api";

/**
 * A booking and its history.
 *
 * Fetched on the server: there is nothing progressive about a single record, and
 * rendering it server-side means the page is complete on arrival rather than
 * flashing a skeleton for one request.
 */
export const dynamic = "force-dynamic";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

async function loadBooking(id: string): Promise<BookingDetail | null> {
  const response = await fetch(`${API_URL}/api/bookings/${id}`, { cache: "no-store" });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Booking service returned ${response.status}`);
  return (await response.json()) as BookingDetail;
}

/** Which payment provider the API is running, so the page can offer the right controls. */
async function loadProvider(): Promise<string> {
  try {
    const response = await fetch(`${API_URL}/health`, { cache: "no-store" });
    const body = (await response.json()) as { payments?: string };
    return body.payments ?? "fake";
  } catch {
    return "fake";
  }
}

export default async function BookingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [data, provider] = await Promise.all([loadBooking(id), loadProvider()]);
  if (data === null) notFound();

  const { booking, events, transactions } = data;

  return (
    <div className="max-w-2xl">
      <a href="/" className="text-xs text-muted underline">
        ← Back to search
      </a>

      <h1 className="mt-4 text-2xl font-semibold tracking-tight">{booking.hotelName}</h1>
      <p className="mt-1 text-sm text-muted">
        {booking.city} · {booking.checkIn} → {booking.checkOut} · {booking.nights} nights ·{" "}
        {booking.guests} guests
      </p>

      <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-3 border-y border-line py-4 text-sm">
        <div>
          <dt className="text-xs text-muted">Status</dt>
          <dd className="font-medium">{booking.status}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Total</dt>
          <dd className="font-medium tabular-nums">{formatMoney(booking.total)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Guest</dt>
          <dd>{booking.guestName}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Reference</dt>
          <dd className="font-mono text-xs">{booking.id}</dd>
        </div>
      </dl>

      <div className="mt-8 grid gap-10 sm:grid-cols-2">
        <BookingTimeline events={events} status={booking.status} />
        <StateMachineLegend status={booking.status} />
      </div>

      <div className="mt-10">
        <LedgerTable entries={transactions} currency={booking.total.currency} />
      </div>

      <div className="mt-10">
        <PaymentPanel
          bookingId={booking.id}
          status={booking.status}
          apiUrl={API_URL}
          simulated={provider === "fake"}
        />
      </div>
    </div>
  );
}
