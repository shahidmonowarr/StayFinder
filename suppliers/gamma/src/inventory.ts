/**
 * SupplierGamma's inventory, in SupplierGamma's own vocabulary.
 *
 * Gamma quotes nightly rates in minor units like Alpha, but buries them under
 * two levels of nesting on the wire and shouts its property names in upper
 * case. Several of these are the same buildings Alpha and Beta sell, priced
 * differently and spelled differently.
 */

export interface GammaHotel {
  id: string;
  name: string;
  city: string;
  stars: number;
  perNightAmount: number;
  currencyCode: string;
  refundable: boolean;
  maxGuests: number;
}

export const GAMMA_INVENTORY: readonly GammaHotel[] = [
  {
    id: "gamma:hotel:7",
    name: "GRAND MERIDIAN LISBON",
    city: "Lisbon",
    stars: 5,
    perNightAmount: 13500,
    currencyCode: "EUR",
    // Same property Alpha sells as refundable. Merging has to pick a side.
    refundable: false,
    maxGuests: 4,
  },
  {
    id: "gamma:hotel:12",
    name: "CASA DO TEJO",
    city: "Lisbon",
    stars: 4,
    perNightAmount: 8100,
    currencyCode: "EUR",
    refundable: true,
    maxGuests: 3,
  },
  {
    id: "gamma:hotel:31",
    name: "PALÁCIO DA RIBEIRA",
    city: "Porto",
    stars: 5,
    perNightAmount: 14900,
    currencyCode: "EUR",
    refundable: true,
    maxGuests: 4,
  },
  {
    id: "gamma:hotel:35",
    name: "Douro View Inn",
    city: "Porto",
    stars: 3,
    perNightAmount: 6400,
    currencyCode: "EUR",
    refundable: false,
    maxGuests: 2,
  },
  {
    id: "gamma:hotel:52",
    name: "eixample grand hotel",
    city: "Barcelona",
    stars: 4,
    perNightAmount: 12100,
    currencyCode: "EUR",
    refundable: true,
    maxGuests: 4,
  },
  {
    id: "gamma:hotel:58",
    name: "Gothic Quarter Rooms",
    city: "Barcelona",
    stars: 3,
    perNightAmount: 7050,
    currencyCode: "EUR",
    refundable: true,
    maxGuests: 2,
  },
  {
    id: "gamma:hotel:71",
    name: "Salamanca-Royal",
    city: "Madrid",
    stars: 5,
    perNightAmount: 15200,
    currencyCode: "EUR",
    refundable: false,
    maxGuests: 4,
  },
  {
    id: "gamma:hotel:80",
    name: "Retiro Garden Hotel",
    city: "Madrid",
    stars: 4,
    perNightAmount: 8900,
    currencyCode: "EUR",
    refundable: true,
    maxGuests: 3,
  },
];

export function findHotel(hotelId: string): GammaHotel | undefined {
  return GAMMA_INVENTORY.find((hotel) => hotel.id === hotelId);
}

export function searchInventory(destination: string, guests: number): GammaHotel[] {
  const wanted = destination.trim().toLowerCase();
  return GAMMA_INVENTORY.filter(
    (hotel) => hotel.city.toLowerCase() === wanted && hotel.maxGuests >= guests,
  );
}
