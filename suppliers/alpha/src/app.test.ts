import request from "supertest";
import { describe, expect, it } from "vitest";
import { CONTRACT, createApp } from "./app";

const app = createApp({ delayMs: () => 0 });

const STAY = { checkIn: "2026-09-01", checkOut: "2026-09-04", guests: "2" };

function search(overrides: Record<string, string> = {}) {
  return request(app)
    .get("/hotels")
    .query({ destination: "Lisbon", ...STAY, ...overrides });
}

describe("supplier-alpha health", () => {
  it("reports health, contract, and inventory size", async () => {
    const res = await request(app).get("/health").expect(200);

    expect(res.body.service).toBe("supplier-alpha");
    expect(res.body.status).toBe("ok");
    expect(res.body.contract).toEqual(JSON.parse(JSON.stringify(CONTRACT)));
    expect(res.body.inventorySize).toBeGreaterThan(0);
  });
});

describe("supplier-alpha search", () => {
  it("returns inventory for a known destination", async () => {
    const res = await search().expect(200);

    expect(res.body.count).toBeGreaterThan(0);
    expect(res.body.hotels).toHaveLength(res.body.count);
    expect(res.body.hotels.every((h: { city: string }) => h.city === "Lisbon")).toBe(true);
  });

  it("returns an empty result set rather than an error for an unknown destination", async () => {
    const res = await search({ destination: "Atlantis" }).expect(200);

    expect(res.body).toEqual({ hotels: [], count: 0 });
  });

  it("excludes properties that cannot hold the party", async () => {
    const forFour = await search({ guests: "4" }).expect(200);
    const forOne = await search({ guests: "1" }).expect(200);

    expect(forFour.body.count).toBeLessThan(forOne.body.count);
    expect(forFour.body.hotels.every((h: { maxGuests: number }) => h.maxGuests >= 4)).toBe(true);
  });

  it("rejects malformed requests with Alpha's error shape", async () => {
    const cases: [Record<string, string>, string][] = [
      [{ destination: "" }, "destination"],
      [{ checkIn: "01-09-2026" }, "checkIn"],
      [{ checkOut: "2026-09-01" }, "checkOut"],
      [{ guests: "0" }, "guests"],
    ];

    for (const [overrides, field] of cases) {
      const res = await search(overrides).expect(400);
      expect(res.body.error, `for ${field}`).toBe("INVALID_REQUEST");
      expect(typeof res.body.message).toBe("string");
    }
  });
});

describe("supplier-alpha quote", () => {
  it("re-quotes at exactly the price search advertised", async () => {
    const searched = await search().expect(200);
    const hotel = searched.body.hotels[0];

    const quoted = await request(app).get(`/hotels/${hotel.hotelId}/quote`).query(STAY).expect(200);

    // Alpha is the stable control case — this equality is what makes Gamma's
    // drift detectable as a supplier behaviour rather than an aggregator bug.
    expect(quoted.body.nightlyRateCents).toBe(hotel.nightlyRateCents);
    expect(quoted.body.nights).toBe(3);
    expect(quoted.body.refundable).toBe(hotel.refundable);
  });

  it("404s an unknown hotel", async () => {
    const res = await request(app).get("/hotels/ALPHA-9999/quote").query(STAY).expect(404);

    expect(res.body.error).toBe("HOTEL_NOT_FOUND");
  });

  it("409s when the party is too large for the room", async () => {
    const res = await request(app)
      .get("/hotels/ALPHA-1090/quote")
      .query({ ...STAY, guests: "8" })
      .expect(409);

    expect(res.body.error).toBe("OCCUPANCY_EXCEEDED");
  });
});

describe("supplier-alpha wire contract", () => {
  // These assertions exist to stop a future refactor from quietly making the
  // three suppliers agree with each other. If that ever happens the project
  // stops demonstrating anything.
  it("speaks camelCase with integer minor units and a per-night basis", async () => {
    const res = await search().expect(200);
    const hotel = res.body.hotels[0];

    expect(Object.keys(hotel).sort()).toEqual([
      "city",
      "currency",
      "hotelId",
      "maxGuests",
      "name",
      "nightlyRateCents",
      "refundable",
      "starRating",
    ]);
    expect(Object.keys(hotel).every((key) => !key.includes("_"))).toBe(true);
    expect(Number.isInteger(hotel.nightlyRateCents)).toBe(true);
    expect(typeof hotel.starRating).toBe("number");
  });

  it("never reports a stay total, whatever the length of stay", async () => {
    const short = await search({ checkOut: "2026-09-02" }).expect(200);
    const long = await search({ checkOut: "2026-09-10" }).expect(200);

    expect(short.body.hotels[0].nightlyRateCents).toBe(long.body.hotels[0].nightlyRateCents);
  });
});
