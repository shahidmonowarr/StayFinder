import type { HotelOption } from "./hotel-option";

/**
 * Property identity, inferred rather than looked up.
 *
 * The three suppliers share no key. They sell the same buildings under
 * different IDs and spell the names differently — "Grand Meridian Lisbon",
 * "Grand Meridian, Lisbon", "GRAND MERIDIAN LISBON" — so identity has to be
 * derived from the property itself.
 *
 * A production OTA solves this with a property-mapping service: a curated
 * table joining supplier IDs to an internal property ID, maintained by people.
 * Name normalization is the miniature stand-in for that table, and it has the
 * same failure mode — two genuinely different hotels with the same name in the
 * same city would collide, and one hotel renamed between suppliers would not
 * merge. That is a real limitation, not an oversight.
 */
export function normalizePropertyName(value: string): string {
  return (
    value
      // Decompose accented characters, then drop the combining marks, so
      // "Palácio" and "Palacio" converge.
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      // Punctuation and repeated whitespace carry no identity: this collapses
      // the comma, the hyphen, and the double space the suppliers disagree on.
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
  );
}

/** Stable key for a physical property, independent of who is selling it. */
export function dedupeKeyFor(property: { name: string; city: string }): string {
  return `${normalizePropertyName(property.name)}|${normalizePropertyName(property.city)}`;
}

export interface PropertyGroup {
  dedupeKey: string;
  /** Cheapest offer for the stay. Also the first entry in `offers`. */
  best: HotelOption;
  /** Every supplier's offer for this property, cheapest first. */
  offers: HotelOption[];
}

/**
 * Collapse a flat option list into one group per physical property.
 *
 * Deliberately a *view* over the options rather than a filter applied inside
 * `/api/search`: the losing offers are not noise. The Grand Meridian is
 * cheaper from Alpha and refundable from Alpha but not from Gamma, and a user
 * may well want the pricier refundable rate. The API therefore returns every
 * offer and the UI groups them here, so nothing is thrown away on the way.
 *
 * Comparison is on `amountMinor` alone. That is sound only because the whole
 * system is single-currency by design; a multi-currency build would have to
 * convert before it could rank.
 */
export function groupByProperty(options: readonly HotelOption[]): PropertyGroup[] {
  const byKey = new Map<string, HotelOption[]>();

  for (const option of options) {
    const existing = byKey.get(option.dedupeKey);
    if (existing) {
      existing.push(option);
    } else {
      byKey.set(option.dedupeKey, [option]);
    }
  }

  const groups: PropertyGroup[] = [];

  for (const [dedupeKey, offers] of byKey) {
    const sorted = [...offers].sort(compareByPrice);
    // Non-null: a key only exists because at least one option created it.
    const best = sorted[0]!;
    groups.push({ dedupeKey, best, offers: sorted });
  }

  // Cheapest property first, then by key, so the order never depends on Map
  // insertion order and tests stay stable.
  return groups.sort(
    (a, b) =>
      a.best.totalPrice.amountMinor - b.best.totalPrice.amountMinor ||
      a.dedupeKey.localeCompare(b.dedupeKey),
  );
}

/**
 * Total ordering for options: price, then supplier, then id. The tie-breakers
 * exist so a response is byte-identical across runs — without them, two
 * equally priced offers could swap places between requests.
 */
export function compareByPrice(a: HotelOption, b: HotelOption): number {
  return (
    a.totalPrice.amountMinor - b.totalPrice.amountMinor ||
    a.supplier.localeCompare(b.supplier) ||
    a.id.localeCompare(b.id)
  );
}
