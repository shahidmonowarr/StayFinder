import type { SupplierMeta } from "@stayfinder/shared";
import { afterAll, describe, expect, it } from "vitest";
import { RedisSearchCache } from "./redis";
import type { CachedSearch } from "./types";

/**
 * Redis integration, skipped unless `REDIS_URL` is set.
 *
 * CI provides a `redis:7` service container, so this suite runs there on every
 * push. Locally it is skipped rather than requiring Docker to be up — the
 * in-memory cache is the supported no-dependency path and it has its own tests.
 *
 * The gap this leaves is honest and worth naming: on a laptop without Redis,
 * nothing here is exercised. Run `docker compose up -d` and
 * `REDIS_URL=redis://localhost:6379 npm test -w @stayfinder/api` to close it.
 */

const redisUrl = process.env.REDIS_URL;
const describeRedis = redisUrl === undefined || redisUrl === "" ? describe.skip : describe;

function meta(status: SupplierMeta["status"]): SupplierMeta {
  return { supplier: "alpha", status, latencyMs: 100, resultCount: 0, droppedCount: 0 };
}

const VALUE: CachedSearch = { options: [], suppliers: [meta("ok")] };

describeRedis("RedisSearchCache", () => {
  const clients: { quit: () => Promise<unknown> }[] = [];

  async function connect(ttlSeconds = 60) {
    const { default: Redis } = await import("ioredis");
    const client = new Redis(redisUrl!, { maxRetriesPerRequest: 1 });
    clients.push(client);
    return new RedisSearchCache(client, ttlSeconds);
  }

  afterAll(async () => {
    await Promise.all(clients.map((client) => client.quit().catch(() => undefined)));
  });

  it("reports itself as the redis backend", async () => {
    const cache = await connect();

    expect(cache.kind).toBe("redis");
  });

  it("returns nothing for an unknown key", async () => {
    const cache = await connect();

    await expect(cache.get(`search:v1:test:absent:${Date.now()}`)).resolves.toBeUndefined();
  });

  it("round-trips a stored value through JSON", async () => {
    const cache = await connect();
    const key = `search:v1:test:roundtrip:${Date.now()}`;

    await cache.set(key, VALUE);

    await expect(cache.get(key)).resolves.toEqual(VALUE);
  });

  it("applies a TTL, so entries do not outlive their prices", async () => {
    const cache = await connect(1);
    const key = `search:v1:test:ttl:${Date.now()}`;
    await cache.set(key, VALUE);

    await new Promise((resolve) => setTimeout(resolve, 1200));

    await expect(cache.get(key)).resolves.toBeUndefined();
  });
});
