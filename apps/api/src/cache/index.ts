import { InMemorySearchCache } from "./memory";
import { resilientCache } from "./resilient";
import { SEARCH_CACHE_TTL_SECONDS, type SearchCache } from "./types";

export * from "./types";
export { InMemorySearchCache } from "./memory";
export { RedisSearchCache } from "./redis";
export { resilientCache } from "./resilient";

function logCacheError(operation: string, error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error);
  console.warn(`[api] search cache ${operation} failed, continuing uncached: ${detail}`);
}

/** The always-available cache. No network, no dependency, no configuration. */
export function createMemoryCache(): SearchCache {
  return resilientCache(new InMemorySearchCache(), logCacheError);
}

/**
 * Build the cache the environment asks for, falling back to memory.
 *
 * `ioredis` is imported dynamically so the in-memory path never loads it — and
 * so a demo with no `REDIS_URL` pays nothing for a dependency it does not use.
 *
 * The connection settings all point the same way: fail fast. A wrong
 * `REDIS_URL` should cost a few hundred milliseconds at boot and then get out of
 * the way, not hang startup or retry forever behind every search.
 */
export async function createSearchCache(redisUrl: string | undefined): Promise<SearchCache> {
  if (redisUrl === undefined || redisUrl === "") {
    return createMemoryCache();
  }

  try {
    const { default: Redis } = await import("ioredis");
    const { RedisSearchCache } = await import("./redis");

    const client = new Redis(redisUrl, {
      lazyConnect: true,
      connectTimeout: 1000,
      commandTimeout: 500,
      maxRetriesPerRequest: 1,
      // Without this, ioredis queues commands while disconnected and they
      // resolve late — turning a dead cache into added latency on every search.
      enableOfflineQueue: false,
    });

    // A listener is required: an unhandled ioredis 'error' event is fatal to the
    // process, which would mean an unreachable cache taking down the API.
    client.on("error", (error: unknown) => {
      logCacheError("connection", error);
    });

    await client.connect();
    console.info(`[api] search cache: redis, ${SEARCH_CACHE_TTL_SECONDS}s TTL`);
    return resilientCache(new RedisSearchCache(client), logCacheError);
  } catch (error) {
    logCacheError("connect", error);
    console.info("[api] search cache: in-memory fallback");
    return createMemoryCache();
  }
}
