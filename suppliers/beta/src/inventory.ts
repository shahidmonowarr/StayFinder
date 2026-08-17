/**
 * SupplierBeta's inventory, in SupplierBeta's own vocabulary.
 *
 * Beta indexes destinations by city code rather than name, describes star
 * ratings as an enum string, and — critically — only ever quotes the price of
 * the whole stay. The nightly base below is internal: it never appears on the
 * wire. Beta computes `total_price` from it at request time, which is why the
 * aggregator has to divide to get a comparable per-night figure.
 *
 * Two properties carry no `category` at all. Real suppliers have gaps, and the
 * M3 adapter must degrade to "unrated" rather than assume the field is there.
 */

export interface BetaHotel {
  hotel_id: string;
  hotel_name: string;
  city_name: string;
  city_code: string;
  /** Absent for properties Beta has not classified. */
  category?: string;
  /** Internal only — never serialized. */
  nightly_base_cents: number;
  currency: string;
  cancellation_policy: "FREE_CANCELLATION" | "NON_REFUNDABLE";
  max_occupancy: number;
}

export const BETA_INVENTORY: readonly BetaHotel[] = [
  {
    hotel_id: "bt_88",
    // Alpha calls this "Grand Meridian Lisbon" — same building, different comma.
    hotel_name: "Grand Meridian, Lisbon",
    city_name: "Lisbon",
    city_code: "LIS",
    category: "4_STAR",
    nightly_base_cents: 12500,
    currency: "EUR",
    cancellation_policy: "FREE_CANCELLATION",
    max_occupancy: 4,
  },
  {
    hotel_id: "bt_91",
    hotel_name: "Hotel Baixa Central",
    city_name: "Lisbon",
    city_code: "LIS",
    // No category — Beta has never classified this property.
    nightly_base_cents: 5400,
    currency: "EUR",
    cancellation_policy: "NON_REFUNDABLE",
    max_occupancy: 2,
  },
  {
    hotel_id: "bt_103",
    hotel_name: "Palácio da Ribeira",
    city_name: "Porto",
    city_code: "OPO",
    category: "5_STAR",
    // Cheaper than Alpha's 14200 for the same property: the slowest supplier
    // holds the best price, so the M4 streaming UI visibly re-sorts when Beta
    // finally answers.
    nightly_base_cents: 13800,
    currency: "EUR",
    cancellation_policy: "FREE_CANCELLATION",
    max_occupancy: 4,
  },
  {
    hotel_id: "bt_110",
    hotel_name: "Douro View Inn",
    city_name: "Porto",
    city_code: "OPO",
    category: "3_STAR",
    nightly_base_cents: 6700,
    currency: "EUR",
    cancellation_policy: "NON_REFUNDABLE",
    max_occupancy: 2,
  },
  {
    hotel_id: "bt_115",
    hotel_name: "Gaia Riverside",
    city_name: "Porto",
    city_code: "OPO",
    // No category.
    nightly_base_cents: 7100,
    currency: "EUR",
    cancellation_policy: "FREE_CANCELLATION",
    max_occupancy: 3,
  },
  {
    hotel_id: "bt_207",
    // Double space, where Alpha and Gamma use one.
    hotel_name: "Eixample  Grand Hotel",
    city_name: "Barcelona",
    city_code: "BCN",
    category: "4_STAR",
    nightly_base_cents: 11200,
    currency: "EUR",
    cancellation_policy: "FREE_CANCELLATION",
    max_occupancy: 4,
  },
  {
    hotel_id: "bt_219",
    hotel_name: "Sagrada Suites",
    city_name: "Barcelona",
    city_code: "BCN",
    category: "4_STAR",
    nightly_base_cents: 9900,
    currency: "EUR",
    cancellation_policy: "NON_REFUNDABLE",
    max_occupancy: 3,
  },
  {
    hotel_id: "bt_301",
    hotel_name: "Salamanca Royal",
    city_name: "Madrid",
    city_code: "MAD",
    category: "5_STAR",
    nightly_base_cents: 16100,
    currency: "EUR",
    cancellation_policy: "FREE_CANCELLATION",
    max_occupancy: 4,
  },
  {
    hotel_id: "bt_312",
    hotel_name: "Gran Vía Central",
    city_name: "Madrid",
    city_code: "MAD",
    category: "4_STAR",
    nightly_base_cents: 9400,
    currency: "EUR",
    cancellation_policy: "FREE_CANCELLATION",
    max_occupancy: 3,
  },
];

export function findHotel(hotelId: string): BetaHotel | undefined {
  return BETA_INVENTORY.find((hotel) => hotel.hotel_id === hotelId);
}

export function isKnownCityCode(code: string): boolean {
  return BETA_INVENTORY.some((hotel) => hotel.city_code === code.toUpperCase());
}

/** Beta matches on city code only — it has no idea what "Lisbon" means. */
export function searchInventory(cityCode: string, occupancy: number): BetaHotel[] {
  const code = cityCode.toUpperCase();
  return BETA_INVENTORY.filter(
    (hotel) => hotel.city_code === code && hotel.max_occupancy >= occupancy,
  );
}
