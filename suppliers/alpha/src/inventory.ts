/**
 * SupplierAlpha's inventory, in SupplierAlpha's own vocabulary.
 *
 * Each supplier keeps its own catalogue on purpose. Sharing one between the
 * three services would hand the aggregator a join key it would never have
 * against real suppliers — the whole point of the dedup work in M3 is that no
 * such key exists and identity has to be inferred from the property itself.
 *
 * Alpha quotes nightly rates in integer cents and nothing else.
 */

export interface AlphaHotel {
  hotelId: string;
  name: string;
  city: string;
  starRating: number;
  nightlyRateCents: number;
  currency: string;
  refundable: boolean;
  maxGuests: number;
}

export const ALPHA_INVENTORY: readonly AlphaHotel[] = [
  {
    hotelId: "ALPHA-1042",
    name: "Grand Meridian Lisbon",
    city: "Lisbon",
    starRating: 5,
    nightlyRateCents: 12990,
    currency: "EUR",
    refundable: true,
    maxGuests: 4,
  },
  {
    hotelId: "ALPHA-1077",
    name: "Casa do Tejo",
    city: "Lisbon",
    starRating: 4,
    nightlyRateCents: 8450,
    currency: "EUR",
    refundable: true,
    maxGuests: 3,
  },
  {
    hotelId: "ALPHA-1090",
    name: "Alfama Boutique",
    city: "Lisbon",
    starRating: 3,
    nightlyRateCents: 6100,
    currency: "EUR",
    refundable: false,
    maxGuests: 2,
  },
  {
    hotelId: "ALPHA-2011",
    // Beta and Gamma spell this one with an accent; Alpha does not. The
    // aggregator has to strip diacritics to see they are the same property.
    name: "Palacio da Ribeira",
    city: "Porto",
    starRating: 5,
    nightlyRateCents: 14200,
    currency: "EUR",
    refundable: true,
    maxGuests: 4,
  },
  {
    hotelId: "ALPHA-2044",
    name: "Porto Station Hotel",
    city: "Porto",
    starRating: 3,
    nightlyRateCents: 5900,
    currency: "EUR",
    refundable: false,
    maxGuests: 2,
  },
  {
    hotelId: "ALPHA-3005",
    name: "Eixample Grand Hotel",
    city: "Barcelona",
    starRating: 4,
    nightlyRateCents: 11750,
    currency: "EUR",
    refundable: true,
    maxGuests: 4,
  },
  {
    hotelId: "ALPHA-3019",
    name: "Gothic Quarter Rooms",
    city: "Barcelona",
    starRating: 3,
    nightlyRateCents: 7300,
    currency: "EUR",
    refundable: false,
    maxGuests: 2,
  },
  {
    hotelId: "ALPHA-3050",
    name: "Barceloneta Bay",
    city: "Barcelona",
    starRating: 4,
    nightlyRateCents: 10400,
    currency: "EUR",
    refundable: true,
    maxGuests: 3,
  },
  {
    hotelId: "ALPHA-4008",
    name: "Salamanca Royal",
    city: "Madrid",
    starRating: 5,
    nightlyRateCents: 15600,
    currency: "EUR",
    refundable: true,
    maxGuests: 4,
  },
  {
    hotelId: "ALPHA-4021",
    name: "Gran Via Central",
    city: "Madrid",
    starRating: 4,
    nightlyRateCents: 9800,
    currency: "EUR",
    refundable: true,
    maxGuests: 3,
  },
];

export function findHotel(hotelId: string): AlphaHotel | undefined {
  return ALPHA_INVENTORY.find((hotel) => hotel.hotelId === hotelId);
}

/** Alpha matches destinations against the city name, case-insensitively. */
export function searchInventory(destination: string, guests: number): AlphaHotel[] {
  const wanted = destination.trim().toLowerCase();
  return ALPHA_INVENTORY.filter(
    (hotel) => hotel.city.toLowerCase() === wanted && hotel.maxGuests >= guests,
  );
}
