import { dedupeKeyFor, fromMinor, type HotelOption, type SupplierId } from "@stayfinder/shared";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { SupplierProgress } from "@/lib/search-stream";
import { ResultsList } from "./results-list";
import { SupplierStatusStrip } from "./supplier-status-strip";

function option(
  supplier: SupplierId,
  name: string,
  totalMinor: number,
  refundable = true,
): HotelOption {
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
    refundable,
    dedupeKey: dedupeKeyFor({ name, city: "Lisbon" }),
  };
}

function progress(
  supplier: SupplierId,
  state: SupplierProgress["state"],
  meta?: Partial<{ latencyMs: number; resultCount: number; droppedCount: number }>,
): SupplierProgress {
  if (meta === undefined) return { supplier, state };
  return {
    supplier,
    state,
    meta: {
      supplier,
      status: state === "ok" ? "ok" : state === "timeout" ? "timeout" : "error",
      latencyMs: meta.latencyMs ?? 100,
      resultCount: meta.resultCount ?? 0,
      droppedCount: meta.droppedCount ?? 0,
    },
  };
}

describe("SupplierStatusStrip", () => {
  it("renders nothing before the stream has announced any suppliers", () => {
    const { container } = render(
      <SupplierStatusStrip suppliers={[]} cached={false} elapsedMs={null} />,
    );

    expect(container.firstChild).toBeNull();
  });

  it("shows every supplier as waiting up front", () => {
    render(
      <SupplierStatusStrip
        suppliers={[progress("alpha", "pending"), progress("beta", "pending")]}
        cached={false}
        elapsedMs={null}
      />,
    );

    expect(screen.getByTestId("supplier-alpha-detail").textContent).toBe("waiting");
    expect(screen.getByTestId("supplier-beta-detail").textContent).toBe("waiting");
  });

  it("reports latency and rate count for a supplier that answered", () => {
    render(
      <SupplierStatusStrip
        suppliers={[progress("alpha", "ok", { latencyMs: 103, resultCount: 3 })]}
        cached={false}
        elapsedMs={1400}
      />,
    );

    expect(screen.getByTestId("supplier-alpha-detail").textContent).toBe("103ms · 3 rates");
  });

  it("surfaces dropped rows, so partial success is visible rather than silent", () => {
    render(
      <SupplierStatusStrip
        suppliers={[progress("alpha", "ok", { latencyMs: 90, resultCount: 2, droppedCount: 1 })]}
        cached={false}
        elapsedMs={null}
      />,
    );

    expect(screen.getByTestId("supplier-alpha-detail").textContent).toBe(
      "90ms · 2 rates, 1 dropped",
    );
  });

  it("distinguishes a timeout from a failure", () => {
    render(
      <SupplierStatusStrip
        suppliers={[
          progress("beta", "timeout", { latencyMs: 1505 }),
          progress("gamma", "error", { latencyMs: 306 }),
        ]}
        cached={false}
        elapsedMs={1510}
      />,
    );

    expect(screen.getByTestId("supplier-beta-detail").textContent).toBe("timed out after 1505ms");
    expect(screen.getByTestId("supplier-gamma-detail").textContent).toBe("failed after 306ms");
  });

  it("says when a response came from cache instead of showing a fake timing", () => {
    render(
      <SupplierStatusStrip
        suppliers={[progress("alpha", "ok", { latencyMs: 103, resultCount: 3 })]}
        cached
        elapsedMs={1}
      />,
    );

    expect(screen.getByText("served from cache")).toBeDefined();
  });
});

describe("ResultsList", () => {
  it("shows skeletons while waiting with nothing yet", () => {
    render(<ResultsList options={[]} waiting />);

    expect(screen.getByTestId("skeletons")).toBeDefined();
  });

  it("explains an empty result set rather than showing a blank page", () => {
    render(<ResultsList options={[]} waiting={false} />);

    expect(screen.getByText(/No rooms came back/)).toBeDefined();
  });

  it("collapses one property sold by three suppliers into a single card", () => {
    render(
      <ResultsList
        options={[
          option("alpha", "Grand Meridian Lisbon", 38970),
          option("beta", "Grand Meridian, Lisbon", 37500),
          option("gamma", "GRAND MERIDIAN LISBON", 40500),
        ]}
        waiting={false}
      />,
    );

    expect(screen.getByText("1 property · 3 offers")).toBeDefined();
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(1);
  });

  it("headlines the cheapest offer and keeps the others reachable", () => {
    render(
      <ResultsList
        options={[
          option("alpha", "Grand Meridian Lisbon", 38970, true),
          option("gamma", "GRAND MERIDIAN LISBON", 37000, false),
        ]}
        waiting={false}
      />,
    );

    // Gamma is cheaper but non-refundable; both facts have to be visible.
    expect(screen.getByText("€370.00")).toBeDefined();
    expect(screen.getByText("Non-refundable")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: /Also from 1 other supplier/ }));

    expect(screen.getByText("€389.70")).toBeDefined();
    expect(screen.getByText("refundable")).toBeDefined();
  });

  it("never shouts a property name back at the user", () => {
    render(
      <ResultsList
        options={[
          option("gamma", "GRAND MERIDIAN LISBON", 37000),
          option("alpha", "Grand Meridian Lisbon", 38970),
        ]}
        waiting={false}
      />,
    );

    expect(screen.getByRole("heading", { level: 3 }).textContent).toBe("Grand Meridian Lisbon");
  });

  it("says the list is still growing while a supplier is outstanding", () => {
    render(<ResultsList options={[option("alpha", "Alfama Boutique", 18300)]} waiting />);

    expect(screen.getByText(/still gathering/)).toBeDefined();
  });
});
