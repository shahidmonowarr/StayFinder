import type { SearchQuery } from "@stayfinder/shared";
import { RecentBookings, type RecentBooking } from "@/components/recent-bookings";
import { SearchExperience } from "@/components/search-experience";

/**
 * Defaults are computed on the server and handed down as props.
 *
 * Computing them in the client component instead would mean the server and the
 * browser could disagree about "today" across a midnight boundary, which React
 * reports as a hydration mismatch. One authority, passed down, has no such race.
 */
export const dynamic = "force-dynamic";

function isoDate(daysFromNow: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + daysFromNow);
  return date.toISOString().slice(0, 10);
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/** Never allowed to break the page: the search works with or without this list. */
async function loadRecentBookings(): Promise<RecentBooking[]> {
  try {
    const response = await fetch(`${API_URL}/api/bookings?limit=6`, { cache: "no-store" });
    if (!response.ok) return [];
    const body = (await response.json()) as { bookings?: RecentBooking[] };
    return body.bookings ?? [];
  } catch {
    return [];
  }
}

export default async function HomePage() {
  const initialQuery: SearchQuery = {
    destination: "Lisbon",
    checkIn: isoDate(14),
    checkOut: isoDate(17),
    guests: 2,
  };

  const recent = await loadRecentBookings();

  return (
    <div>
      <h1 className="max-w-3xl text-[26px] leading-[1.15] font-semibold tracking-tight text-balance">
        Three suppliers, one search, none of them in agreement.
      </h1>
      <p className="mt-3 max-w-2xl text-[13.5px] leading-relaxed text-muted">
        Every search asks three hotel suppliers at once and gives each 1.5 seconds. The spans below
        are drawn to scale against that deadline — watch a supplier miss it, and watch the results
        carry on without it.
      </p>

      <div className="mt-7">
        <SearchExperience initialQuery={initialQuery} streamOptions={{ baseUrl: API_URL }} />
      </div>

      <RecentBookings bookings={recent} />
    </div>
  );
}
