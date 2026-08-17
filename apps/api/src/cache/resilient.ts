import type { CachedSearch, SearchCache } from "./types";

/**
 * Wraps a cache so it can never break a search.
 *
 * A cache is an optimization. If Redis is unreachable, has been flushed, or
 * starts returning nonsense, the correct behaviour is a slower search — not a
 * failed one. So a failed `get` reads as a miss and a failed `set` is dropped,
 * both reported through `onError` so the failure is visible in logs rather than
 * silent.
 *
 * This is the single place that guarantee lives, which is why the two cache
 * implementations underneath are free to be thin and to throw.
 */
export function resilientCache(
  inner: SearchCache,
  onError: (operation: string, error: unknown) => void,
): SearchCache {
  return {
    kind: inner.kind,

    async get(key: string): Promise<CachedSearch | undefined> {
      try {
        return await inner.get(key);
      } catch (error) {
        onError("get", error);
        // A broken cache is indistinguishable from an empty one, by design.
        return undefined;
      }
    },

    async set(key: string, value: CachedSearch): Promise<void> {
      try {
        await inner.set(key, value);
      } catch (error) {
        onError("set", error);
      }
    },

    async close(): Promise<void> {
      try {
        await inner.close();
      } catch (error) {
        onError("close", error);
      }
    },
  };
}
