import { dedupeKeyFor, fromMinor, type HotelOption, type SupplierId } from "@stayfinder/shared";
import { describe, expect, it } from "vitest";
import {
  initialSearchStreamState,
  isWaitingForAnySupplier,
  searchStreamReducer,
  type SearchStreamState,
} from "./search-stream";

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
    checkIn: "2026-09-01",
    checkOut: "2026-09-04",
    nights: 3,
    guests: 2,
    refundable: true,
    dedupeKey: dedupeKeyFor({ name, city: "Lisbon" }),
  };
}

function meta(supplier: SupplierId, status: "ok" | "timeout" | "error", resultCount = 0) {
  return { supplier, status, latencyMs: 100, resultCount, droppedCount: 0 } as const;
}

function started(): SearchStreamState {
  const state = searchStreamReducer(initialSearchStreamState, { type: "start" });
  return searchStreamReducer(state, {
    type: "meta",
    event: {
      query: { destination: "Lisbon", checkIn: "2026-09-01", checkOut: "2026-09-04", guests: 2 },
      suppliers: ["alpha", "beta", "gamma"],
      cached: false,
    },
  });
}

describe("meta", () => {
  it("renders the full strip as pending before anyone has answered", () => {
    const state = started();

    expect(state.suppliers.map((s) => `${s.supplier}:${s.state}`)).toEqual([
      "alpha:pending",
      "beta:pending",
      "gamma:pending",
    ]);
  });

  it("records whether the response is cached", () => {
    const state = searchStreamReducer(started(), {
      type: "meta",
      event: {
        query: { destination: "Lisbon", checkIn: "2026-09-01", checkOut: "2026-09-04", guests: 2 },
        suppliers: ["alpha"],
        cached: true,
      },
    });

    expect(state.cached).toBe(true);
  });
});

describe("leg", () => {
  it("moves only the answering supplier out of pending", () => {
    const state = searchStreamReducer(started(), {
      type: "leg",
      event: { meta: meta("alpha", "ok", 1), options: [option("alpha", "A", 30000)] },
    });

    expect(state.suppliers.map((s) => s.state)).toEqual(["ok", "pending", "pending"]);
  });

  it("accumulates options across legs", () => {
    let state = searchStreamReducer(started(), {
      type: "leg",
      event: { meta: meta("alpha", "ok", 1), options: [option("alpha", "A", 30000)] },
    });
    state = searchStreamReducer(state, {
      type: "leg",
      event: { meta: meta("gamma", "ok", 1), options: [option("gamma", "C", 40000)] },
    });

    expect(state.options).toHaveLength(2);
  });

  it("re-sorts so a cheap late supplier jumps to the top", () => {
    // The visible payoff of streaming: Beta is slowest and cheapest, and the
    // list must reorder when it finally lands.
    let state = searchStreamReducer(started(), {
      type: "leg",
      event: { meta: meta("alpha", "ok", 1), options: [option("alpha", "A", 38970)] },
    });
    expect(state.options[0]?.supplier).toBe("alpha");

    state = searchStreamReducer(state, {
      type: "leg",
      event: { meta: meta("beta", "ok", 1), options: [option("beta", "B", 37500)] },
    });

    expect(state.options[0]?.supplier).toBe("beta");
  });

  it("records a failed supplier and contributes no options", () => {
    const state = searchStreamReducer(started(), {
      type: "leg",
      event: { meta: meta("gamma", "error"), options: [] },
    });

    expect(state.suppliers[2]?.state).toBe("error");
    expect(state.options).toEqual([]);
  });

  it("keeps a timeout distinct from an error", () => {
    let state = searchStreamReducer(started(), {
      type: "leg",
      event: { meta: meta("beta", "timeout"), options: [] },
    });
    state = searchStreamReducer(state, {
      type: "leg",
      event: { meta: meta("gamma", "error"), options: [] },
    });

    expect(state.suppliers.map((s) => s.state)).toEqual(["pending", "timeout", "error"]);
  });
});

describe("slow", () => {
  it("ages still-waiting suppliers into slow", () => {
    const state = searchStreamReducer(started(), { type: "slow" });

    expect(state.suppliers.every((s) => s.state === "slow")).toBe(true);
  });

  it("never relabels a supplier that already answered", () => {
    let state = searchStreamReducer(started(), {
      type: "leg",
      event: { meta: meta("alpha", "ok", 1), options: [] },
    });
    state = searchStreamReducer(state, { type: "slow" });

    expect(state.suppliers.map((s) => s.state)).toEqual(["ok", "slow", "slow"]);
  });

  it("does not resurrect a supplier that already failed", () => {
    let state = searchStreamReducer(started(), {
      type: "leg",
      event: { meta: meta("gamma", "error"), options: [] },
    });
    state = searchStreamReducer(state, { type: "slow" });

    expect(state.suppliers[2]?.state).toBe("error");
  });
});

describe("done and failure", () => {
  it("finishes and records elapsed time", () => {
    const state = searchStreamReducer(started(), { type: "done", event: { elapsedMs: 1420 } });

    expect(state.phase).toBe("done");
    expect(state.elapsedMs).toBe(1420);
  });

  it("marks outstanding suppliers as failed when the stream breaks", () => {
    let state = searchStreamReducer(started(), {
      type: "leg",
      event: { meta: meta("alpha", "ok", 1), options: [option("alpha", "A", 30000)] },
    });
    state = searchStreamReducer(state, { type: "failed", message: "Lost connection" });

    // Leaving them spinning forever would be the dishonest option.
    expect(state.suppliers.map((s) => s.state)).toEqual(["ok", "error", "error"]);
    expect(state.error).toBe("Lost connection");
    expect(state.phase).toBe("done");
  });

  it("keeps results that already arrived when the stream breaks", () => {
    let state = searchStreamReducer(started(), {
      type: "leg",
      event: { meta: meta("alpha", "ok", 1), options: [option("alpha", "A", 30000)] },
    });
    state = searchStreamReducer(state, { type: "failed", message: "Lost connection" });

    expect(state.options).toHaveLength(1);
  });
});

describe("start", () => {
  it("discards the previous search's results", () => {
    // Showing Lisbon prices under a Porto search would be worse than a blank.
    let state = searchStreamReducer(started(), {
      type: "leg",
      event: { meta: meta("alpha", "ok", 1), options: [option("alpha", "A", 30000)] },
    });
    state = searchStreamReducer(state, { type: "start" });

    expect(state.options).toEqual([]);
    expect(state.suppliers).toEqual([]);
    expect(state.phase).toBe("streaming");
  });
});

describe("isWaitingForAnySupplier", () => {
  it("is true while any supplier is pending or slow", () => {
    expect(isWaitingForAnySupplier(started())).toBe(true);
  });

  it("is false once every supplier has settled", () => {
    let state = started();
    for (const supplier of ["alpha", "beta", "gamma"] as const) {
      state = searchStreamReducer(state, {
        type: "leg",
        event: { meta: meta(supplier, "ok"), options: [] },
      });
    }

    expect(isWaitingForAnySupplier(state)).toBe(false);
  });
});
