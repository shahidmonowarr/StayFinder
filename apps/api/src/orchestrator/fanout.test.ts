import {
  dedupeKeyFor,
  fromMinor,
  type HotelOption,
  type SearchQuery,
  type SupplierId,
} from "@stayfinder/shared";
import { describe, expect, it } from "vitest";
import { SupplierResponseError, type SupplierAdapter } from "../adapters/types";
import { fanOut } from "./fanout";

const QUERY: SearchQuery = {
  destination: "Lisbon",
  checkIn: "2026-09-01",
  checkOut: "2026-09-04",
  guests: 2,
};

function option(supplier: SupplierId, name: string, totalMinor: number): HotelOption {
  return {
    id: `${supplier}:${name}`,
    supplier,
    supplierHotelId: name,
    name,
    city: "Lisbon",
    starRating: 4,
    nightlyRate: fromMinor(Math.round(totalMinor / 3), "EUR"),
    totalPrice: fromMinor(totalMinor, "EUR"),
    checkIn: QUERY.checkIn,
    checkOut: QUERY.checkOut,
    nights: 3,
    guests: 2,
    refundable: true,
    dedupeKey: dedupeKeyFor({ name, city: "Lisbon" }),
  };
}

function okAdapter(id: SupplierId, options: HotelOption[], dropped = 0): SupplierAdapter {
  return { id, search: () => Promise.resolve({ options, dropped }) };
}

function failingAdapter(id: SupplierId, error: Error): SupplierAdapter {
  return { id, search: () => Promise.reject(error) };
}

/** Never resolves on its own — only the deadline can end it. */
function hangingAdapter(id: SupplierId): SupplierAdapter {
  return {
    id,
    search: (_query, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          reject(signal.reason);
        });
      }),
  };
}

/** Answers, but only after `ms` — used to prove slow legs still land in time. */
function slowAdapter(id: SupplierId, ms: number, options: HotelOption[]): SupplierAdapter {
  return {
    id,
    search: (_query, signal) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          resolve({ options, dropped: 0 });
        }, ms);
        signal.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(signal.reason);
        });
      }),
  };
}

describe("fanOut — the happy path", () => {
  it("collects options from every supplier", async () => {
    const result = await fanOut(
      [
        okAdapter("alpha", [option("alpha", "A", 30000)]),
        okAdapter("beta", [option("beta", "B", 20000)]),
        okAdapter("gamma", [option("gamma", "C", 40000)]),
      ],
      QUERY,
    );

    expect(result.options).toHaveLength(3);
    expect(result.suppliers.map((s) => s.status)).toEqual(["ok", "ok", "ok"]);
  });

  it("sorts merged options by total price", async () => {
    const result = await fanOut(
      [
        okAdapter("alpha", [option("alpha", "expensive", 40000)]),
        okAdapter("beta", [option("beta", "cheap", 10000)]),
        okAdapter("gamma", [option("gamma", "middle", 25000)]),
      ],
      QUERY,
    );

    expect(result.options.map((o) => o.name)).toEqual(["cheap", "middle", "expensive"]);
  });

  it("reports suppliers in adapter order, not completion order", async () => {
    // Otherwise the UI's status strip would reshuffle on every request.
    const result = await fanOut(
      [
        slowAdapter("alpha", 40, [option("alpha", "A", 10000)]),
        okAdapter("beta", [option("beta", "B", 20000)]),
        okAdapter("gamma", [option("gamma", "C", 30000)]),
      ],
      QUERY,
    );

    expect(result.suppliers.map((s) => s.supplier)).toEqual(["alpha", "beta", "gamma"]);
  });

  it("counts results and dropped rows per supplier", async () => {
    const result = await fanOut(
      [okAdapter("alpha", [option("alpha", "A", 10000), option("alpha", "B", 20000)], 3)],
      QUERY,
    );

    expect(result.suppliers[0]).toMatchObject({
      supplier: "alpha",
      status: "ok",
      resultCount: 2,
      droppedCount: 3,
    });
  });

  it("treats a supplier with no inventory as a success, not a failure", async () => {
    const result = await fanOut([okAdapter("beta", [])], QUERY);

    expect(result.suppliers[0]?.status).toBe("ok");
    expect(result.suppliers[0]?.resultCount).toBe(0);
    expect(result.suppliers[0]?.message).toBeUndefined();
  });
});

describe("fanOut — isolation", () => {
  it("returns the other suppliers' results when one times out", async () => {
    const result = await fanOut(
      [
        okAdapter("alpha", [option("alpha", "A", 10000)]),
        hangingAdapter("beta"),
        okAdapter("gamma", [option("gamma", "C", 30000)]),
      ],
      QUERY,
      { timeoutMs: 30 },
    );

    expect(result.options.map((o) => o.supplier)).toEqual(["alpha", "gamma"]);
    expect(result.suppliers.map((s) => s.status)).toEqual(["ok", "timeout", "ok"]);
  });

  it("distinguishes a timeout from an error", async () => {
    const result = await fanOut(
      [hangingAdapter("beta"), failingAdapter("gamma", new SupplierResponseError("gamma", 500))],
      QUERY,
      { timeoutMs: 30 },
    );

    const [beta, gamma] = result.suppliers;
    expect(beta?.status).toBe("timeout");
    expect(beta?.message).toMatch(/deadline/i);
    expect(gamma?.status).toBe("error");
    expect(gamma?.message).toMatch(/HTTP 500/);
  });

  it("survives every supplier failing at once", async () => {
    const result = await fanOut(
      [
        failingAdapter("alpha", new Error("connection refused")),
        hangingAdapter("beta"),
        failingAdapter("gamma", new SupplierResponseError("gamma", 500)),
      ],
      QUERY,
      { timeoutMs: 30 },
    );

    // A search where every supplier fell over is still a resolved search with
    // an honest status block — never a rejection.
    expect(result.options).toEqual([]);
    expect(result.suppliers).toHaveLength(3);
    expect(result.suppliers.every((s) => s.status !== "ok")).toBe(true);
  });

  it("unwraps the cause so a connection failure names itself", async () => {
    // Node's fetch reports every transport failure as "fetch failed" and buries
    // the real reason in `cause`. Without unwrapping, a dead supplier and a DNS
    // failure look identical in the status strip.
    const wrapped = new TypeError("fetch failed");
    (wrapped as { cause?: unknown }).cause = new Error("connect ECONNREFUSED 127.0.0.1:4001");

    const result = await fanOut([failingAdapter("alpha", wrapped)], QUERY);

    expect(result.suppliers[0]?.message).toBe("fetch failed: connect ECONNREFUSED 127.0.0.1:4001");
  });

  it("unwraps an AggregateError cause, which is what a `localhost` URL produces", async () => {
    // `localhost` resolves to both ::1 and 127.0.0.1, so undici tries both and
    // wraps the pair in an AggregateError whose own message is the empty string.
    // Reading `.message` on it loses the reason entirely — this is the case the
    // first version of the unwrapping missed.
    const wrapped = new TypeError("fetch failed");
    (wrapped as { cause?: unknown }).cause = new AggregateError([
      new Error("connect ECONNREFUSED ::1:4001"),
      new Error("connect ECONNREFUSED 127.0.0.1:4001"),
    ]);

    const result = await fanOut([failingAdapter("alpha", wrapped)], QUERY);

    expect(result.suppliers[0]?.message).toBe("fetch failed: connect ECONNREFUSED ::1:4001");
  });

  it("falls back to the outer message when there is no usable cause", async () => {
    const result = await fanOut([failingAdapter("alpha", new Error("plain failure"))], QUERY);

    expect(result.suppliers[0]?.message).toBe("plain failure");
  });

  it("falls back when the aggregate carries nothing readable", async () => {
    const wrapped = new TypeError("fetch failed");
    (wrapped as { cause?: unknown }).cause = new AggregateError([]);

    const result = await fanOut([failingAdapter("alpha", wrapped)], QUERY);

    expect(result.suppliers[0]?.message).toBe("fetch failed");
  });

  it("classifies a non-Error rejection rather than crashing on it", async () => {
    const rogue: SupplierAdapter = { id: "alpha", search: () => Promise.reject("just a string") };

    const result = await fanOut([rogue], QUERY);

    expect(result.suppliers[0]?.status).toBe("error");
    expect(result.suppliers[0]?.message).toMatch(/unknown reason/i);
  });

  it("gives each supplier its own deadline", async () => {
    // If the legs shared one signal, aborting the hung supplier would cancel
    // the slow-but-healthy one too, and Alpha would never land.
    const result = await fanOut(
      [hangingAdapter("beta"), slowAdapter("alpha", 20, [option("alpha", "A", 10000)])],
      QUERY,
      {
        timeoutMs: 60,
      },
    );

    expect(result.suppliers[0]?.status).toBe("timeout");
    expect(result.suppliers[1]?.status).toBe("ok");
    expect(result.options).toHaveLength(1);
  });
});

describe("fanOut — deadlines", () => {
  it("runs the legs concurrently, so the total is one timeout and not three", async () => {
    const startedAt = performance.now();

    await fanOut(
      [hangingAdapter("alpha"), hangingAdapter("beta"), hangingAdapter("gamma")],
      QUERY,
      {
        timeoutMs: 80,
      },
    );

    const elapsed = performance.now() - startedAt;
    // Three sequential 80ms deadlines would be 240ms. Generous upper bound so
    // the assertion is about concurrency, not about machine speed.
    expect(elapsed).toBeLessThan(200);
  });

  it("lets a supplier that answers inside the deadline through", async () => {
    const result = await fanOut([slowAdapter("beta", 20, [option("beta", "B", 20000)])], QUERY, {
      timeoutMs: 200,
    });

    expect(result.suppliers[0]?.status).toBe("ok");
    expect(result.options).toHaveLength(1);
  });

  it("records latency for successful and failed legs alike", async () => {
    // A fake clock advancing 10ms per reading, which also documents the
    // concurrency: both legs are *started* (readings 1 and 2) before either
    // *finishes* (readings 3 and 4), so each measures a span of 20 rather than
    // 10. Sequential legs would read 10, 20 / 30, 40 and measure 10 each.
    let tick = 0;
    const now = () => {
      tick += 10;
      return tick;
    };

    const result = await fanOut(
      [okAdapter("alpha", []), failingAdapter("beta", new Error("nope"))],
      QUERY,
      { now },
    );

    // Real elapsed time here is under a millisecond, so a non-zero value can
    // only have come from the injected clock.
    expect(result.suppliers[0]?.latencyMs).toBe(20);
    expect(result.suppliers[1]?.latencyMs).toBe(20);
  });
});
