/**
 * Real supplier payloads, captured by curling the running services during M2
 * for `destination=Lisbon, 2026-09-01 → 2026-09-04, guests=2`.
 *
 * Test-only. They live in `src` rather than a fixtures folder because the
 * adapter tests and the route integration tests both need them, and because a
 * fixture that drifts from the real supplier is worse than no fixture — keeping
 * it beside the adapter makes the drift obvious.
 */

export const ALPHA_SEARCH_PAYLOAD = {
  hotels: [
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
  ],
  count: 3,
};

export const BETA_SEARCH_PAYLOAD = {
  results: [
    {
      hotel_id: "bt_88",
      hotel_name: "Grand Meridian, Lisbon",
      city_name: "Lisbon",
      total_price: "375.00",
      currency: "EUR",
      cancellation_policy: "FREE_CANCELLATION",
      max_occupancy: 4,
      nights: 3,
      category: "4_STAR",
    },
    {
      // No `category` key at all — Beta omits it for unclassified properties.
      hotel_id: "bt_91",
      hotel_name: "Hotel Baixa Central",
      city_name: "Lisbon",
      total_price: "162.00",
      currency: "EUR",
      cancellation_policy: "NON_REFUNDABLE",
      max_occupancy: 2,
      nights: 3,
    },
  ],
  result_count: 2,
};

export const GAMMA_SEARCH_PAYLOAD = {
  data: {
    searchHotels: {
      totalCount: 2,
      edges: [
        {
          node: {
            id: "gamma:hotel:7",
            maxGuests: 4,
            property: {
              name: "GRAND MERIDIAN LISBON",
              city: "Lisbon",
              rating: { stars: 5 },
            },
            pricing: {
              refundable: false,
              perNight: { amount: 13500, currency: { code: "EUR" } },
            },
          },
        },
        {
          node: {
            id: "gamma:hotel:12",
            maxGuests: 3,
            property: {
              name: "CASA DO TEJO",
              city: "Lisbon",
              rating: { stars: 4 },
            },
            pricing: {
              refundable: true,
              perNight: { amount: 8100, currency: { code: "EUR" } },
            },
          },
        },
      ],
    },
  },
};

/** What Gamma returns when a resolver rejects: HTTP 200 with an errors array. */
export const GAMMA_ERROR_PAYLOAD = {
  errors: [{ message: "No such hotel" }],
  data: null,
};
