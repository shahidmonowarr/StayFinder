import { act, render, screen } from "@testing-library/react";
import type { SearchQuery } from "@stayfinder/shared";
import { describe, expect, it, vi } from "vitest";
import { searchStreamUrl, useSearchStream, type EventSourceLike } from "./use-search-stream";

const QUERY: SearchQuery = {
  destination: "Lisbon",
  checkIn: "2026-09-01",
  checkOut: "2026-09-04",
  guests: 2,
};

/** Stands in for EventSource, which jsdom does not provide. */
class FakeEventSource implements EventSourceLike {
  static instances: FakeEventSource[] = [];

  closed = false;
  readonly listeners = new Map<string, ((event: { data?: string }) => void)[]>();

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: { data?: string }) => void): void {
    const existing = this.listeners.get(type) ?? [];
    existing.push(listener);
    this.listeners.set(type, existing);
  }

  close(): void {
    this.closed = true;
  }

  emit(type: string, data?: unknown): void {
    act(() => {
      for (const listener of this.listeners.get(type) ?? []) {
        listener(data === undefined ? {} : { data: JSON.stringify(data) });
      }
    });
  }
}

function Probe({ query }: { query: SearchQuery | null }) {
  const state = useSearchStream(query, {
    baseUrl: "http://api.test",
    eventSourceFactory: (url) => new FakeEventSource(url),
    slowAfterMs: 50,
  });

  return (
    <div>
      <span data-testid="phase">{state.phase}</span>
      <span data-testid="count">{state.options.length}</span>
      <span data-testid="cached">{String(state.cached)}</span>
      <span data-testid="states">{state.suppliers.map((s) => s.state).join(",")}</span>
      <span data-testid="error">{state.error ?? ""}</span>
    </div>
  );
}

function latest(): FakeEventSource {
  const instance = FakeEventSource.instances.at(-1);
  if (instance === undefined) throw new Error("No EventSource was opened");
  return instance;
}

function metaEvent() {
  return { query: QUERY, suppliers: ["alpha", "beta", "gamma"], cached: false };
}

function legEvent(supplier: string, status: string) {
  return {
    meta: { supplier, status, latencyMs: 100, resultCount: 0, droppedCount: 0 },
    options: [],
  };
}

describe("searchStreamUrl", () => {
  it("encodes the query as the API expects", () => {
    expect(searchStreamUrl("http://api.test", QUERY)).toBe(
      "http://api.test/api/search/stream?destination=Lisbon&checkIn=2026-09-01&checkOut=2026-09-04&guests=2",
    );
  });
});

describe("useSearchStream", () => {
  it("opens a stream and reports progress", () => {
    FakeEventSource.instances = [];
    render(<Probe query={QUERY} />);

    expect(screen.getByTestId("phase").textContent).toBe("streaming");

    latest().emit("meta", metaEvent());
    expect(screen.getByTestId("states").textContent).toBe("pending,pending,pending");

    latest().emit("leg", legEvent("alpha", "ok"));
    expect(screen.getByTestId("states").textContent).toBe("ok,pending,pending");
  });

  it("does not open a stream without a query", () => {
    FakeEventSource.instances = [];
    render(<Probe query={null} />);

    expect(FakeEventSource.instances).toHaveLength(0);
    expect(screen.getByTestId("phase").textContent).toBe("idle");
  });

  it("closes the connection on done, so EventSource cannot silently re-run the search", () => {
    // EventSource reconnects on its own. Leaving it open after `done` would
    // re-issue the whole fan-out, forever.
    FakeEventSource.instances = [];
    render(<Probe query={QUERY} />);
    const source = latest();

    source.emit("meta", metaEvent());
    source.emit("done", { elapsedMs: 1200 });

    expect(source.closed).toBe(true);
    expect(screen.getByTestId("phase").textContent).toBe("done");
  });

  it("ages pending suppliers into slow", async () => {
    vi.useFakeTimers();
    try {
      FakeEventSource.instances = [];
      render(<Probe query={QUERY} />);
      latest().emit("meta", metaEvent());
      latest().emit("leg", legEvent("alpha", "ok"));

      act(() => {
        vi.advanceTimersByTime(60);
      });

      expect(screen.getByTestId("states").textContent).toBe("ok,slow,slow");
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports a broken stream instead of spinning forever", () => {
    FakeEventSource.instances = [];
    render(<Probe query={QUERY} />);
    latest().emit("meta", metaEvent());

    latest().emit("error");

    expect(screen.getByTestId("error").textContent).toMatch(/lost connection/i);
    expect(screen.getByTestId("states").textContent).toBe("error,error,error");
  });

  it("ignores an error that arrives after a clean finish", () => {
    FakeEventSource.instances = [];
    render(<Probe query={QUERY} />);
    const source = latest();
    source.emit("meta", metaEvent());
    source.emit("done", { elapsedMs: 900 });

    source.emit("error");

    expect(screen.getByTestId("error").textContent).toBe("");
  });

  it("closes the previous stream when the query changes", () => {
    FakeEventSource.instances = [];
    const { rerender } = render(<Probe query={QUERY} />);
    const first = latest();

    rerender(<Probe query={{ ...QUERY, destination: "Porto" }} />);

    expect(first.closed).toBe(true);
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(latest().url).toContain("destination=Porto");
  });

  it("does not re-open the stream when the caller passes a fresh factory each render", () => {
    // Regression: the factory used to be an effect dependency, so an inline
    // lambda re-subscribed on every render — and since subscribing dispatches
    // `start`, that loop never terminated. It ended in an out-of-memory crash,
    // not a failing assertion, which is why it gets its own test.
    FakeEventSource.instances = [];
    const { rerender } = render(<Probe query={QUERY} />);

    rerender(<Probe query={QUERY} />);
    rerender(<Probe query={QUERY} />);

    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it("closes the stream on unmount", () => {
    FakeEventSource.instances = [];
    const { unmount } = render(<Probe query={QUERY} />);
    const source = latest();

    unmount();

    expect(source.closed).toBe(true);
  });

  it("surfaces a cached response", () => {
    FakeEventSource.instances = [];
    render(<Probe query={QUERY} />);

    latest().emit("meta", { ...metaEvent(), cached: true });

    expect(screen.getByTestId("cached").textContent).toBe("true");
  });
});
