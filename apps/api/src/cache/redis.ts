import type { Redis } from "ioredis";
import { SEARCH_CACHE_TTL_SECONDS, type CachedSearch, type SearchCache } from "./types";

/**
 * Redis-backed search cache.
 *
 * Deliberately thin and allowed to throw: every call is wrapped by
 * `resilientCache`, which is where the "a cache must never break a search"
 * guarantee lives. Splitting those concerns means this class stays readable and
 * the resilience is tested once instead of twice.
 *
 * `JSON.parse` output is trusted here rather than re-validated. That is safe
 * only because we wrote the value ourselves under a versioned key — the `v1` in
 * the key is what makes it safe, and dropping it would make this a real bug.
 */
export class RedisSearchCache implements SearchCache {
  readonly kind = "redis" as const;

  constructor(
    private readonly client: Redis,
    private readonly ttlSeconds: number = SEARCH_CACHE_TTL_SECONDS,
  ) {}

  async get(key: string): Promise<CachedSearch | undefined> {
    const raw = await this.client.get(key);
    return raw === null ? undefined : (JSON.parse(raw) as CachedSearch);
  }

  async set(key: string, value: CachedSearch): Promise<void> {
    await this.client.set(key, JSON.stringify(value), "EX", this.ttlSeconds);
  }

  async close(): Promise<void> {
    await this.client.quit();
  }
}
