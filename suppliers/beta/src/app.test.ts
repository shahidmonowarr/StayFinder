import request from "supertest";
import { describe, expect, it } from "vitest";
import { CONTRACT, createApp } from "./app";

const app = createApp({ delayMs: () => 0 });

const STAY = { check_in_date: "2026-09-01", check_out_date: "2026-09-04", occupancy: "2" };

function availability(overrides: Record<string, string> = {}) {
  return request(app)
    .get("/v1/availability")
    .query({ destination_code: "LIS", ...STAY, ...overrides });
}

describe("supplier-beta health", () => {
  it("reports health, contract, and inventory size", async () => {
    const res = await request(app).get("/health").expect(200);

    expect(res.body.service).toBe("supplier-beta");
    expect(res.body.contract).toEqual(JSON.parse(JSON.stringify(CONTRACT)));
    expect(res.body.inventory_size).toBeGreaterThan(0);
  });
});

describe("supplier-beta availability", () => {
  it("returns inventory for a known city code", async () => {
    const res = await availability().expect(200);

    expect(res.body.result_count).toBeGreaterThan(0);
    expect(res.body.results).toHaveLength(res.body.result_count);
    expect(res.body.results.every((r: { city_name: string }) => r.city_name === "Lisbon")).toBe(
      true,
    );
  });

  it("knows nothing about city names — only codes", async () => {
    const res = await availability({ destination_code: "LIS" }).expect(200);
    const byName = await availability({ destination_code: "LISBON" }).expect(400);

    expect(res.body.result_count).toBeGreaterThan(0);
    expect(byName.body.error_code).toBe("invalid_destination");
  });

  it("excludes properties that cannot hold the party", async () => {
    const res = await availability({ occupancy: "4" }).expect(200);

    expect(res.body.results.every((r: { max_occupancy: number }) => r.max_occupancy >= 4)).toBe(
      true,
    );
  });

  it("rejects malformed requests with Beta's error shape", async () => {
    const cases: [Record<string, string>, string][] = [
      [{ destination_code: "" }, "missing_parameter"],
      [{ check_in_date: "2026/09/01" }, "invalid_date"],
      [{ check_out_date: "2026-09-01" }, "invalid_stay"],
      [{ occupancy: "99" }, "invalid_occupancy"],
    ];

    for (const [overrides, expectedCode] of cases) {
      const res = await availability(overrides).expect(400);
      expect(res.body.error_code).toBe(expectedCode);
      expect(typeof res.body.error_message).toBe("string");
    }
  });
});

describe("supplier-beta price", () => {
  it("re-quotes at exactly the price availability advertised", async () => {
    const searched = await availability().expect(200);
    const first = searched.body.results[0];

    const quoted = await request(app)
      .get(`/v1/availability/${first.hotel_id}/price`)
      .query(STAY)
      .expect(200);

    expect(quoted.body.total_price).toBe(first.total_price);
    expect(quoted.body.nights).toBe(3);
  });

  it("404s an unknown hotel", async () => {
    const res = await request(app)
      .get("/v1/availability/bt_does_not_exist/price")
      .query(STAY)
      .expect(404);

    expect(res.body.error_code).toBe("unknown_hotel");
  });
});

describe("supplier-beta wire contract", () => {
  it("speaks snake_case with decimal-string prices and a separate currency field", async () => {
    const res = await availability().expect(200);
    const result = res.body.results.find((r: { hotel_id: string }) => r.hotel_id === "bt_88");

    expect(Object.keys(result).every((key) => key === key.toLowerCase())).toBe(true);
    expect(Object.keys(result).some((key) => key.includes("_"))).toBe(true);
    // The price is a *string*. A consumer reaching for parseFloat here is the
    // bug the shared Money module exists to prevent.
    expect(typeof result.total_price).toBe("string");
    expect(result.total_price).toMatch(/^\d+\.\d{2}$/);
    expect(result.currency).toBe("EUR");
  });

  it("prices the whole stay, not a night", async () => {
    const oneNight = await availability({ check_out_date: "2026-09-02" }).expect(200);
    const threeNights = await availability().expect(200);

    const one = oneNight.body.results.find((r: { hotel_id: string }) => r.hotel_id === "bt_88");
    const three = threeNights.body.results.find(
      (r: { hotel_id: string }) => r.hotel_id === "bt_88",
    );

    expect(one.total_price).toBe("125.00");
    expect(three.total_price).toBe("375.00");
    expect(three.nights).toBe(3);
  });

  it("omits category entirely for unclassified properties", async () => {
    const res = await availability({ occupancy: "1" }).expect(200);
    const unclassified = res.body.results.find((r: { hotel_id: string }) => r.hotel_id === "bt_91");
    const classified = res.body.results.find((r: { hotel_id: string }) => r.hotel_id === "bt_88");

    // Absent, not null — consumers must handle a missing key.
    expect("category" in unclassified).toBe(false);
    expect(classified.category).toBe("4_STAR");
  });
});
