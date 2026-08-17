import type { HotelOption } from "@stayfinder/shared";

/**
 * Choose which supplier's spelling of a property name to show.
 *
 * The same building arrives as "Grand Meridian Lisbon", "Grand Meridian,
 * Lisbon", and "GRAND MERIDIAN LISBON". Rendering whichever happened to be
 * cheapest means the card SHOUTS at the user whenever Gamma wins.
 *
 * A real OTA resolves this from its property master record. Here, the rule is a
 * proxy for that: prefer a name that is already sentence-shaped — one with both
 * upper and lower case — and only fall back to re-casing when every supplier
 * sends an unusable one.
 */
export function pickDisplayName(offers: readonly HotelOption[]): string {
  const names = offers.map((offer) => offer.name);
  const wellCased = names.find((name) => hasMixedCase(name));
  if (wellCased !== undefined) return wellCased;

  return titleCase(names[0] ?? "");
}

function hasMixedCase(name: string): boolean {
  const letters = name.replace(/[^A-Za-z]/g, "");
  if (letters === "") return false;
  return letters !== letters.toUpperCase() && letters !== letters.toLowerCase();
}

function titleCase(name: string): string {
  return name
    .toLowerCase()
    .replace(/(^|\s)(\p{L})/gu, (_match, boundary: string, letter: string) => {
      return `${boundary}${letter.toUpperCase()}`;
    });
}
