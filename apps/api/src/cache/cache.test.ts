import type { SearchQuery, SupplierMeta } from "@stayfinder/shared";
import { describe, expect, it, vi } from "vitest";
import { InMemorySearchCache } from "./memory";
import { resilientCache } from "./resilient";
import { cacheKeyFor, isCacheable, type CachedSearch, type SearchCache } from "./types";

const QUERY: SearchQuery = {
  destination: "Lisbon",
  checkIn: "2026-09-01",
  checkOut: "2026-09-04",
  guests: 2,
};

function meta(supplier: SupplierMeta["supplier"], status: SupplierMeta["status"]): SupplierMeta {
  return {
    supplier,
    status,
    latencyMs: 100,
    resultCount: status === "ok" ? 2 : 0,
    droppedCount: 0,
  };
}

const VALUE: CachedSearch = { options: [], suppliers: [meta("alpha", "ok")] };

describe("cacheKeyFor", () => {
  it("includes every field that changes the result", () => {
    expect(cacheKeyFor(QUERY)).toBe("search:v1:lisbon:2026-09-01:2026-09-04:2");
  });

  it("normalizes the destination so one search is not two cache entries", () => {
    expect(cacheKeyFor({ ...QUERY, destination: "  LISBON " })).toBe(cacheKeyFor(QUERY));
  });

  it("separates every distinct search", () => {
    const keys = new Set([
      cacheKeyFor(QUERY),
      cacheKeyFor({ ...QUERY, destination: "Porto" }),
      cacheKeyFor({ ...QUERY, checkIn: "2026-09-02" }),
      cacheKeyFor({ ...QUERY, checkOut: "2026-09-05" }),
      cacheKeyFor({ ...QUERY, guests: 3 }),
    ]);

    expect(keys.size).toBe(5);
  });

  it("carries a version prefix, so a shape change can retire old entries", () => {
    // Without this, a running Redis would serve M3-shaped options into M5 code.
    expect(cacheKeyFor(QUERY).startsWith("search:v1:")).toBe(true);
  });
});

describe("isCacheable", () => {
  it("accepts a fully successful fan-out", () => {
    expect(isCacheable([meta("alpha", "ok"), meta("beta", "ok"), meta("gamma", "ok")])).toBe(true);
  });

  it("refuses a result set with a timed-out supplier", () => {
    // Caching this would hand every visitor the degraded set for 60 seconds.
    expect(isCacheable([meta("alpha", "ok"), meta("beta", "timeout")])).toBe(false);
  });

  it("refuses a result set with a failed supplier", () => {
    expect(isCacheable([meta("alpha", "ok"), meta("gamma", "error")])).toBe(false);
  });

  it("refuses an empty supplier list", () => {
    expect(isCacheable([])).toBe(false);
  });
});

describe("InMemorySearchCache", () => {
  it("returns nothing for a key it has never seen", async () => {
    const cache = new InMemorySearchCache();

    await expect(cache.get("missing")).resolves.toBeUndefined();
  });

  it("returns what it stored", async () => {
    const cache = new InMemorySearchCache();
    await cache.set("k", VALUE);

    await expect(cache.get("k")).resolves.toEqual(VALUE);
  });

  it("expires an entry once its TTL has passed", async () => {
    let clock = 1000;
    const cache = new InMemorySearchCache({ ttlMs: 60_000, now: () => clock });
    await cache.set("k", VALUE);

    clock += 59_999;
    await expect(cache.get("k")).resolves.toEqual(VALUE);

    clock += 2;
    await expect(cache.get("k")).resolves.toBeUndefined();
  });

  it("drops the expired entry rather than holding it forever", async () => {
    let clock = 0;
    const cache = new InMemorySearchCache({ ttlMs: 10, now: () => clock });
    await cache.set("k", VALUE);
    clock = 100;

    await cache.get("k");

    expect(cache.size).toBe(0);
  });

  it("evicts the oldest entry once it hits the cap", async () => {
    const cache = new InMemorySearchCache({ maxEntries: 3 });

    for (const key of ["a", "b", "c", "d"]) {
      await cache.set(key, VALUE);
    }

    expect(cache.size).toBe(3);
    await expect(cache.get("a")).resolves.toBeUndefined();
    await expect(cache.get("d")).resolves.toEqual(VALUE);
  });

  it("refreshes an existing key's eviction position when it is re-cached", async () => {
    const cache = new InMemorySearchCache({ maxEntries: 2 });
    await cache.set("a", VALUE);
    await cache.set("b", VALUE);
    // Re-caching "a" should make "b" the oldest, not "a".
    await cache.set("a", VALUE);
    await cache.set("c", VALUE);

    await expect(cache.get("b")).resolves.toBeUndefined();
    await expect(cache.get("a")).resolves.toEqual(VALUE);
  });
});

describe("resilientCache", () => {
  function brokenCache(): SearchCache {
    return {
      kind: "redis",
      get: () => Promise.reject(new Error("READONLY: connection lost")),
      set: () => Promise.reject(new Error("READONLY: connection lost")),
      close: () => Promise.reject(new Error("already gone")),
    };
  }

  it("reports a failed read as a miss", async () => {
    const onError = vi.fn();
    const cache = resilientCache(brokenCache(), onError);

    // A broken cache has to be indistinguishable from an empty one, or every
    // Redis hiccup becomes a failed search.
    await expect(cache.get("k")).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledWith("get", expect.any(Error));
  });

  it("swallows a failed write", async () => {
    const onError = vi.fn();
    const cache = resilientCache(brokenCache(), onError);

    await expect(cache.set("k", VALUE)).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledWith("set", expect.any(Error));
  });

  it("swallows a failed close", async () => {
    const onError = vi.fn();
    const cache = resilientCache(brokenCache(), onError);

    await expect(cache.close()).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledWith("close", expect.any(Error));
  });

  it("reports failures rather than hiding them", async () => {
    const onError = vi.fn();
    const cache = resilientCache(brokenCache(), onError);

    await cache.get("k");

    // Degrading silently and degrading invisibly are different things.
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("passes through the backing cache's kind and behaviour when healthy", async () => {
    const onError = vi.fn();
    const cache = resilientCache(new InMemorySearchCache(), onError);

    await cache.set("k", VALUE);

    expect(cache.kind).toBe("memory");
    await expect(cache.get("k")).resolves.toEqual(VALUE);
    expect(onError).not.toHaveBeenCalled();
  });
});
