/**
 * Gamma's misbehaviour, made reproducible.
 *
 * Two constraints pull in opposite directions. A demo wants Gamma to fail and
 * drift *unpredictably*, so a visitor sees the aggregator absorb a genuine
 * surprise. A test suite — and the M7 chaos-mode button — needs failure and
 * drift *on command*, or neither can assert anything.
 *
 * The resolution: a seeded PRNG rather than `Math.random()`, so a given seed
 * always produces the same sequence of outcomes, plus an `x-chaos` header that
 * overrides the roll entirely. Random by default, deterministic under test,
 * forceable on demand.
 */

export const DEFAULT_FAILURE_RATE = 0.2;
export const DEFAULT_DRIFT_RATE = 0.1;

/** Quote drift lands between 3% and 8%, up or down. */
const MIN_DRIFT = 0.03;
const MAX_DRIFT = 0.08;

/**
 * mulberry32 — a small, fast, well-distributed 32-bit PRNG. Any seeded
 * generator would do; this one is short enough to read in full.
 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export type ChaosOverride = "fail" | "drift" | "none";

/**
 * Read the `x-chaos` request header. Anything unrecognized is ignored rather
 * than rejected — an unknown value means "behave normally", not "error".
 */
export function parseOverride(raw: string | null | undefined): ChaosOverride | undefined {
  switch (raw?.trim().toLowerCase()) {
    case "fail":
      return "fail";
    case "drift":
      return "drift";
    case "none":
      return "none";
    default:
      return undefined;
  }
}

export interface ChaosOptions {
  seed?: number;
  failureRate?: number;
  driftRate?: number;
}

export interface Chaos {
  /** True when this request should fail with a 500. Advances the sequence. */
  shouldFail(override?: ChaosOverride): boolean;
  /** True when this quote should disagree with search. Advances the sequence. */
  shouldDrift(override?: ChaosOverride): boolean;
  /** Apply a 3–8% move, up or down, to a nightly amount in minor units. */
  drift(amount: number): number;
}

export function createChaos(options: ChaosOptions = {}): Chaos {
  const failureRate = options.failureRate ?? DEFAULT_FAILURE_RATE;
  const driftRate = options.driftRate ?? DEFAULT_DRIFT_RATE;
  const random = mulberry32(options.seed ?? Number(process.env.CHAOS_SEED ?? 1));

  return {
    shouldFail(override) {
      if (override === "fail") return true;
      if (override === "none" || override === "drift") return false;
      return random() < failureRate;
    },

    shouldDrift(override) {
      if (override === "drift") return true;
      if (override === "none") return false;
      return random() < driftRate;
    },

    drift(amount) {
      const magnitude = MIN_DRIFT + random() * (MAX_DRIFT - MIN_DRIFT);
      const direction = random() < 0.5 ? -1 : 1;
      const drifted = Math.round(amount * (1 + direction * magnitude));
      // A drift that rounds back to the original price would be invisible to
      // the aggregator and defeat the point, so nudge it off by a cent.
      return drifted === amount ? amount + 1 : drifted;
    },
  };
}
