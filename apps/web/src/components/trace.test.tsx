import type { SupplierId } from "@stayfinder/shared";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { SupplierProgress } from "@/lib/search-stream";
import { ActivityRail } from "./activity-rail";
import { SupplierTrace } from "./supplier-trace";

function pending(supplier: SupplierId): SupplierProgress {
  return { supplier, state: "pending" };
}

function settled(
  supplier: SupplierId,
  state: "ok" | "timeout" | "error",
  latencyMs: number,
  resultCount = 0,
  droppedCount = 0,
): SupplierProgress {
  return {
    supplier,
    state,
    meta: { supplier, status: state, latencyMs, resultCount, droppedCount },
  };
}

/** The rendered width of a supplier's bar, as a number of percent. */
function barWidth(supplier: string): number {
  const stat = screen.getByTestId(`span-${supplier}`);
  const row = stat.closest("li");
  const bar = row?.querySelector<HTMLElement>("div[style*='width']");
  return Number.parseFloat(bar?.style.width ?? "0");
}

describe("SupplierTrace", () => {
  it("renders nothing before the stream has announced any suppliers", () => {
    const { container } = render(<SupplierTrace suppliers={[]} elapsedMs={0} cached={false} />);

    expect(container.firstChild).toBeNull();
  });

  it("draws a bar proportional to how long the supplier actually took", () => {
    // The axis runs to 1600ms, so 400ms is a quarter of the width. Getting this
    // wrong makes every comparison in the trace a lie.
    render(
      <SupplierTrace suppliers={[settled("alpha", "ok", 400, 3)]} elapsedMs={400} cached={false} />,
    );

    expect(barWidth("alpha")).toBeCloseTo(25, 1);
  });

  it("grows an in-flight supplier's bar with the clock", () => {
    // Without this a pending supplier would be an empty row that snaps to full
    // length — showing the deadline's result but never the deadline working.
    const { rerender } = render(
      <SupplierTrace suppliers={[pending("beta")]} elapsedMs={400} cached={false} />,
    );
    const early = barWidth("beta");

    rerender(<SupplierTrace suppliers={[pending("beta")]} elapsedMs={800} cached={false} />);

    expect(barWidth("beta")).toBeGreaterThan(early);
  });

  it("never grows an in-flight bar past the deadline", () => {
    // The API aborted it at 1500ms whatever this component's clock says.
    render(<SupplierTrace suppliers={[pending("beta")]} elapsedMs={9000} cached={false} />);

    expect(barWidth("beta")).toBeCloseTo(93.75, 1);
  });

  it("counts up while a supplier is still out", () => {
    render(<SupplierTrace suppliers={[pending("beta")]} elapsedMs={640} cached={false} />);

    expect(screen.getByTestId("span-beta").textContent).toBe("640ms…");
  });

  it("reports latency and rate count once a supplier answers", () => {
    render(
      <SupplierTrace suppliers={[settled("alpha", "ok", 107, 3)]} elapsedMs={107} cached={false} />,
    );

    expect(screen.getByTestId("span-alpha").textContent).toBe("107ms · 3");
  });

  it("surfaces dropped rows, so partial success is visible rather than silent", () => {
    render(
      <SupplierTrace
        suppliers={[settled("alpha", "ok", 90, 2, 1)]}
        elapsedMs={90}
        cached={false}
      />,
    );

    expect(screen.getByTestId("span-alpha").textContent).toBe("90ms · 2 · 1 dropped");
  });

  it("distinguishes a timeout from a failure in words, not only in colour", () => {
    render(
      <SupplierTrace
        suppliers={[settled("beta", "timeout", 1501), settled("gamma", "error", 306)]}
        elapsedMs={1502}
        cached={false}
      />,
    );

    expect(screen.getByTestId("span-beta").textContent).toBe("timeout · 1501ms");
    expect(screen.getByTestId("span-gamma").textContent).toBe("failed · 306ms");
  });

  it("does not present cached durations as things that just happened", () => {
    // The rail beside this says "no suppliers were asked". A trace drawing
    // live-looking bars next to that sentence contradicts it — which is exactly
    // the kind of quiet dishonesty this whole layout exists to remove.
    render(<SupplierTrace suppliers={[settled("alpha", "ok", 127, 3)]} elapsedMs={0} cached />);

    expect(screen.getByText("cached · no suppliers asked")).toBeDefined();
    expect(screen.getByTestId("span-alpha").textContent).toBe("127ms when cached");
  });
});

describe("ActivityRail", () => {
  it("renders nothing before there is anything to narrate", () => {
    const { container } = render(
      <ActivityRail suppliers={[]} cached={false} optionCount={0} propertyCount={0} />,
    );

    expect(container.firstChild).toBeNull();
  });

  it("narrates arrivals in the order they happened, not adapter order", () => {
    render(
      <ActivityRail
        suppliers={[
          settled("alpha", "ok", 326, 3),
          settled("beta", "ok", 107, 2),
          settled("gamma", "ok", 900, 1),
        ]}
        cached={false}
        optionCount={6}
        propertyCount={4}
      />,
    );

    const entries = screen.getAllByRole("listitem").map((item) => item.textContent ?? "");
    expect(entries[0]).toContain("Asked 3 suppliers");
    expect(entries[1]).toContain("beta");
    expect(entries[2]).toContain("alpha");
    expect(entries[3]).toContain("gamma");
  });

  it("says in plain language what a timeout cost", () => {
    // A hatched bar shows that something happened. This says why it is fine.
    render(
      <ActivityRail
        suppliers={[settled("alpha", "ok", 107, 3), settled("beta", "timeout", 1501)]}
        cached={false}
        optionCount={3}
        propertyCount={3}
      />,
    );

    expect(screen.getByText(/beta ran out of time — the other results were kept/)).toBeDefined();
  });

  it("distinguishes a failure from a timeout", () => {
    render(
      <ActivityRail
        suppliers={[settled("gamma", "error", 306)]}
        cached={false}
        optionCount={0}
        propertyCount={0}
      />,
    );

    expect(screen.getByText(/gamma failed — the search carried on without it/)).toBeDefined();
  });

  it("names suppliers still outstanding rather than omitting them", () => {
    render(
      <ActivityRail
        suppliers={[settled("alpha", "ok", 107, 3), pending("beta")]}
        cached={false}
        optionCount={3}
        propertyCount={3}
      />,
    );

    expect(screen.getByText(/Still waiting on beta/)).toBeDefined();
  });

  it("explains a cache hit instead of narrating suppliers that were never asked", () => {
    render(
      <ActivityRail
        suppliers={[settled("alpha", "ok", 0, 3)]}
        cached
        optionCount={3}
        propertyCount={3}
      />,
    );

    expect(screen.getByText(/60-second cache/)).toBeDefined();
    expect(screen.getByText(/No suppliers were asked/)).toBeDefined();
  });

  it("summarises how many suppliers actually contributed", () => {
    render(
      <ActivityRail
        suppliers={[
          settled("alpha", "ok", 107, 3),
          settled("beta", "timeout", 1501),
          settled("gamma", "ok", 306, 2),
        ]}
        cached={false}
        optionCount={5}
        propertyCount={3}
      />,
    );

    const summary = screen.getByText(/matched across/).textContent ?? "";
    expect(summary).toContain("3 properties");
    expect(summary).toContain("5 offers");
    expect(summary).toContain("2 of 3 suppliers");
  });
});
