import { SEARCH_CACHE_TTL_SECONDS, type CachedSearch, type SearchCache } from "./types";

export interface InMemoryCacheOptions {
  ttlMs?: number;
  /**
   * Hard cap on entries. A demo left running for an afternoon should not grow a
   * cache without bound just because nothing ever evicts it.
   */
  maxEntries?: number;
  /** Injectable clock, so expiry can be tested without waiting for it. */
  now?: () => number;
}

interface Entry {
  value: CachedSearch;
  expiresAt: number;
}

/**
 * The fallback cache, and the reason the demo runs on a laptop with nothing
 * installed. Same TTL semantics as Redis, no network, no dependency.
 *
 * Insertion-ordered eviction rather than true LRU: reads do not promote an
 * entry. With a 60s TTL and a cap of 200 the difference is academic, and LRU
 * bookkeeping would be more code than the behaviour is worth.
 */
export class InMemorySearchCache implements SearchCache {
  readonly kind = "memory" as const;

  private readonly entries = new Map<string, Entry>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(options: InMemoryCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? SEARCH_CACHE_TTL_SECONDS * 1000;
    this.maxEntries = options.maxEntries ?? 200;
    this.now = options.now ?? (() => Date.now());
  }

  get(key: string): Promise<CachedSearch | undefined> {
    const entry = this.entries.get(key);
    if (entry === undefined) return Promise.resolve(undefined);

    if (entry.expiresAt <= this.now()) {
      // Expired entries are dropped on read rather than swept on a timer: no
      // background work, and an unread stale entry harms nobody.
      this.entries.delete(key);
      return Promise.resolve(undefined);
    }

    return Promise.resolve(entry.value);
  }

  set(key: string, value: CachedSearch): Promise<void> {
    // Delete before set so a re-cached key moves to the end of the insertion
    // order instead of keeping its original eviction position.
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });

    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done === true) break;
      this.entries.delete(oldest.value);
    }

    return Promise.resolve();
  }

  close(): Promise<void> {
    this.entries.clear();
    return Promise.resolve();
  }

  /** Test/diagnostic view. Not part of `SearchCache`. */
  get size(): number {
    return this.entries.size;
  }
}
