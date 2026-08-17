import request from "supertest";
import { describe, expect, it } from "vitest";
import { CONTRACT, createApp } from "./app";
import { createChaos } from "./chaos";

/** A Gamma with chaos switched off — the baseline for everything except the chaos tests. */
function calmApp() {
  return createApp({
    chaos: createChaos({ seed: 1, failureRate: 0, driftRate: 0 }),
    delayMs: () => 0,
  });
}

const SEARCH_QUERY = /* GraphQL */ `
  query Search($input: SearchInput!) {
    searchHotels(input: $input) {
      totalCount
      edges {
        node {
          id
          maxGuests
          property {
            name
            city
            rating {
              stars
            }
          }
          pricing {
            refundable
            perNight {
              amount
              currency {
                code
                symbol
              }
            }
          }
        }
      }
    }
  }
`;

const QUOTE_QUERY = /* GraphQL */ `
  query Quote($input: QuoteInput!) {
    hotelQuote(input: $input) {
      hotelId
      nights
      priceChanged
      pricing {
        perNight {
          amount
        }
      }
    }
  }
`;

const STAY = { checkIn: "2026-09-01", checkOut: "2026-09-04", guests: 2 };

function graphql(
  app: ReturnType<typeof createApp>,
  query: string,
  input: Record<string, unknown>,
  chaosHeader?: string,
) {
  const req = request(app).post("/graphql");
  if (chaosHeader) req.set("x-chaos", chaosHeader);
  return req.send({ query, variables: { input } });
}

describe("supplier-gamma health", () => {
  it("never fails, even though the GraphQL surface does", async () => {
    // Health is deliberately outside the chaos path: `npm run dev` must be able
    // to tell you Gamma is up even while it is failing one search in five.
    const app = createApp({
      chaos: createChaos({ seed: 1, failureRate: 1 }),
      delayMs: () => 0,
    });

    for (let i = 0; i < 10; i += 1) {
      const res = await request(app).get("/health").expect(200);
      expect(res.body.service).toBe("supplier-gamma");
    }

    const res = await request(app).get("/health").expect(200);
    expect(res.body.contract).toEqual(JSON.parse(JSON.stringify(CONTRACT)));
    expect(res.body.inventorySize).toBeGreaterThan(0);
  });
});

describe("supplier-gamma search", () => {
  it("returns inventory for a known destination", async () => {
    const res = await graphql(calmApp(), SEARCH_QUERY, { destination: "Lisbon", ...STAY }).expect(
      200,
    );

    const connection = res.body.data.searchHotels;
    expect(connection.totalCount).toBeGreaterThan(0);
    expect(connection.edges).toHaveLength(connection.totalCount);
    expect(
      connection.edges.every(
        (e: { node: { property: { city: string } } }) => e.node.property.city === "Lisbon",
      ),
    ).toBe(true);
  });

  it("returns an empty connection rather than an error for an unknown destination", async () => {
    const res = await graphql(calmApp(), SEARCH_QUERY, {
      destination: "Atlantis",
      ...STAY,
    }).expect(200);

    expect(res.body.data.searchHotels).toEqual({ totalCount: 0, edges: [] });
  });

  it("excludes properties that cannot hold the party", async () => {
    const res = await graphql(calmApp(), SEARCH_QUERY, {
      destination: "Porto",
      ...STAY,
      guests: 4,
    }).expect(200);

    expect(
      res.body.data.searchHotels.edges.every(
        (e: { node: { maxGuests: number } }) => e.node.maxGuests >= 4,
      ),
    ).toBe(true);
  });

  it("reports malformed input as a GraphQL error, not an HTTP error", async () => {
    const res = await graphql(calmApp(), SEARCH_QUERY, {
      destination: "Lisbon",
      checkIn: "2026-09-04",
      checkOut: "2026-09-01",
      guests: 2,
    });

    expect(res.body.errors[0].extensions.code).toBe("BAD_USER_INPUT");
  });
});

describe("supplier-gamma wire contract", () => {
  it("buries the price two levels deep under a connection wrapper", async () => {
    const res = await graphql(calmApp(), SEARCH_QUERY, { destination: "Lisbon", ...STAY }).expect(
      200,
    );

    const node = res.body.data.searchHotels.edges[0].node;

    // Everything the aggregator needs is nested. This is the shape the M3
    // adapter has to flatten into HotelOption.
    expect(Number.isInteger(node.pricing.perNight.amount)).toBe(true);
    expect(node.pricing.perNight.currency.code).toBe("EUR");
    expect(node.pricing.perNight.currency.symbol).toBe("€");
    expect(typeof node.property.rating.stars).toBe("number");
    // Flat access must not work — if it ever does, Gamma stopped being Gamma.
    expect((node as Record<string, unknown>).price).toBeUndefined();
    expect((node as Record<string, unknown>).name).toBeUndefined();
  });
});

describe("supplier-gamma injected failure", () => {
  it("fails with an opaque HTTP 500, not a GraphQL error array", async () => {
    const app = createApp({ chaos: createChaos({ seed: 1, failureRate: 1 }), delayMs: () => 0 });

    const res = await graphql(app, SEARCH_QUERY, { destination: "Lisbon", ...STAY }).expect(500);

    // A failing gateway in front of a supplier does not return well-formed
    // GraphQL. The aggregator has to survive a response it cannot parse.
    expect(res.body.errors).toBeUndefined();
    expect(res.text).toContain("Internal Server Error");
  });

  it("fails on demand via the x-chaos header", async () => {
    await graphql(calmApp(), SEARCH_QUERY, { destination: "Lisbon", ...STAY }, "fail").expect(500);
  });

  it("can be silenced on demand even when the roll says fail", async () => {
    const app = createApp({ chaos: createChaos({ seed: 1, failureRate: 1 }), delayMs: () => 0 });

    await graphql(app, SEARCH_QUERY, { destination: "Lisbon", ...STAY }, "none").expect(200);
  });
});

describe("supplier-gamma quote drift", () => {
  const quoteInput = { hotelId: "gamma:hotel:7", ...STAY };

  it("agrees with search when it does not drift", async () => {
    const app = calmApp();
    const searched = await graphql(app, SEARCH_QUERY, { destination: "Lisbon", ...STAY });
    const node = searched.body.data.searchHotels.edges.find(
      (e: { node: { id: string } }) => e.node.id === "gamma:hotel:7",
    ).node;

    const quoted = await graphql(app, QUOTE_QUERY, quoteInput).expect(200);

    expect(quoted.body.data.hotelQuote.pricing.perNight.amount).toBe(node.pricing.perNight.amount);
    expect(quoted.body.data.hotelQuote.priceChanged).toBe(false);
    expect(quoted.body.data.hotelQuote.nights).toBe(3);
  });

  it("drifts on demand, so the M7 chaos demo can guarantee a price change", async () => {
    const app = calmApp();
    const searched = await graphql(app, SEARCH_QUERY, { destination: "Lisbon", ...STAY });
    const advertised = searched.body.data.searchHotels.edges.find(
      (e: { node: { id: string } }) => e.node.id === "gamma:hotel:7",
    ).node.pricing.perNight.amount;

    const quoted = await graphql(app, QUOTE_QUERY, quoteInput, "drift").expect(200);

    expect(quoted.body.data.hotelQuote.pricing.perNight.amount).not.toBe(advertised);
    expect(quoted.body.data.hotelQuote.priceChanged).toBe(true);
  });

  it("drifts unprompted at roughly the configured rate", async () => {
    const app = createApp({
      chaos: createChaos({ seed: 5, failureRate: 0, driftRate: 0.1 }),
      delayMs: () => 0,
    });

    let drifted = 0;
    for (let i = 0; i < 60; i += 1) {
      const res = await graphql(app, QUOTE_QUERY, quoteInput).expect(200);
      if (res.body.data.hotelQuote.priceChanged) drifted += 1;
    }

    expect(drifted).toBeGreaterThan(0);
    expect(drifted).toBeLessThan(20);
  });

  it("surfaces an unknown hotel as a typed GraphQL error", async () => {
    const res = await graphql(calmApp(), QUOTE_QUERY, { ...quoteInput, hotelId: "gamma:hotel:0" });

    expect(res.body.errors[0].extensions.code).toBe("HOTEL_NOT_FOUND");
  });

  it("rejects a party larger than the room", async () => {
    const res = await graphql(calmApp(), QUOTE_QUERY, {
      ...quoteInput,
      hotelId: "gamma:hotel:58",
      guests: 8,
    });

    expect(res.body.errors[0].extensions.code).toBe("OCCUPANCY_EXCEEDED");
  });
});
