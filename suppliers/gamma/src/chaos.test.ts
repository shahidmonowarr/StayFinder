import { describe, expect, it } from "vitest";
import { createChaos, parseOverride } from "./chaos";

describe("seeded chaos", () => {
  it("produces the same sequence for the same seed", () => {
    const a = createChaos({ seed: 42 });
    const b = createChaos({ seed: 42 });

    const runA = Array.from({ length: 25 }, () => a.shouldFail());
    const runB = Array.from({ length: 25 }, () => b.shouldFail());

    expect(runA).toEqual(runB);
  });

  it("produces a different sequence for a different seed", () => {
    const first = createChaos({ seed: 1 });
    const second = createChaos({ seed: 2 });

    const a = Array.from({ length: 25 }, () => first.shouldFail());
    const b = Array.from({ length: 25 }, () => second.shouldFail());

    expect(a).not.toEqual(b);
  });

  it("fails at roughly the configured rate over many requests", () => {
    const chaos = createChaos({ seed: 7, failureRate: 0.2 });
    const failures = Array.from({ length: 2000 }, () => chaos.shouldFail()).filter(Boolean).length;

    // Deterministic given the seed; the window is wide enough that only a real
    // change to the rate or the generator moves it.
    expect(failures).toBeGreaterThan(340);
    expect(failures).toBeLessThan(460);
  });

  it("never fails when the rate is zero", () => {
    const chaos = createChaos({ seed: 3, failureRate: 0 });

    expect(Array.from({ length: 100 }, () => chaos.shouldFail())).not.toContain(true);
  });
});

describe("chaos overrides", () => {
  it("forces failure on demand regardless of the roll", () => {
    const chaos = createChaos({ seed: 9, failureRate: 0 });

    expect(chaos.shouldFail("fail")).toBe(true);
  });

  it("suppresses failure on demand regardless of the roll", () => {
    const chaos = createChaos({ seed: 9, failureRate: 1 });

    expect(chaos.shouldFail("none")).toBe(false);
  });

  it("does not fail a request that was explicitly asked to drift", () => {
    // Otherwise "force a price change" would be swallowed by a forced 500 and
    // the M7 chaos-mode demo could never show the revalidation path.
    const chaos = createChaos({ seed: 9, failureRate: 1 });

    expect(chaos.shouldFail("drift")).toBe(false);
    expect(chaos.shouldDrift("drift")).toBe(true);
  });

  it("reads the header case-insensitively and ignores anything unknown", () => {
    expect(parseOverride("FAIL")).toBe("fail");
    expect(parseOverride(" drift ")).toBe("drift");
    expect(parseOverride("none")).toBe("none");
    expect(parseOverride("banana")).toBeUndefined();
    expect(parseOverride(undefined)).toBeUndefined();
    expect(parseOverride(null)).toBeUndefined();
  });
});

describe("price drift", () => {
  it("always moves the price, so the change is detectable", () => {
    const chaos = createChaos({ seed: 11 });

    for (let i = 0; i < 200; i += 1) {
      expect(chaos.drift(12990)).not.toBe(12990);
    }
  });

  it("stays within a plausible 3–8% band in either direction", () => {
    const chaos = createChaos({ seed: 13 });
    const base = 12990;

    for (let i = 0; i < 200; i += 1) {
      const drifted = chaos.drift(base);
      const delta = Math.abs(drifted - base) / base;
      expect(delta).toBeGreaterThanOrEqual(0.03 - 0.0001);
      expect(delta).toBeLessThanOrEqual(0.08 + 0.0001);
    }
  });

  it("returns whole minor units, never fractional cents", () => {
    const chaos = createChaos({ seed: 17 });

    for (let i = 0; i < 50; i += 1) {
      expect(Number.isInteger(chaos.drift(8450))).toBe(true);
    }
  });
});
