import type { SearchQuery } from "@stayfinder/shared";
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

export default function HomePage() {
  const initialQuery: SearchQuery = {
    destination: "Lisbon",
    checkIn: isoDate(14),
    checkOut: isoDate(17),
    guests: 2,
  };

  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-balance">
        Three suppliers, one search, none of them in agreement.
      </h1>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">
        Every search fans out to three hotel suppliers in parallel with a 1500ms deadline each.
        Results stream in as they answer — watch the list re-sort when the slowest supplier turns
        out to have the cheapest room, and watch the page carry on when one of them fails.
      </p>

      <div className="mt-8">
        <SearchExperience initialQuery={initialQuery} streamOptions={{ baseUrl: apiUrl }} />
      </div>
    </div>
  );
}
