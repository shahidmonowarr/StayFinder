import { describe, expect, it } from "vitest";
import {
  BOOKING_STATUSES,
  BOOKING_TRANSITIONS,
  IllegalTransitionError,
  INITIAL_STATUS,
  applyTransition,
  canTransition,
  isPaid,
  isTerminal,
  legalTransitions,
  type BookingStatus,
  type BookingTransition,
} from "./booking-state-machine";

/**
 * The complete truth table, written out by hand rather than derived from the
 * implementation. Deriving it would make this file agree with whatever the code
 * does, including its bugs.
 */
const LEGAL: [BookingStatus, BookingTransition, BookingStatus][] = [
  ["PENDING", "confirm", "CONFIRMED"],
  ["PENDING", "fail", "FAILED"],
  ["PENDING", "cancel", "CANCELLED"],
  ["CONFIRMED", "cancel", "CANCELLED"],
  ["CANCELLED", "refund", "REFUNDED"],
];

function isLegal(from: BookingStatus, transition: BookingTransition): boolean {
  return LEGAL.some(([f, t]) => f === from && t === transition);
}

describe("legal transitions", () => {
  it.each(LEGAL)("%s can be %sed into %s", (from, transition, expected) => {
    expect(applyTransition(from, transition)).toBe(expected);
  });

  it("starts every booking as PENDING", () => {
    expect(INITIAL_STATUS).toBe("PENDING");
  });
});

describe("illegal transitions", () => {
  // Every cell of the state × transition matrix that is not in LEGAL must
  // throw. This is the assertion that stops a future edit from quietly widening
  // the machine: adding a permissive branch fails here without anyone having to
  // remember to write a test for it.
  const illegal = BOOKING_STATUSES.flatMap((from) =>
    BOOKING_TRANSITIONS.filter((transition) => !isLegal(from, transition)).map(
      (transition) => [from, transition] as const,
    ),
  );

  it("covers the whole matrix", () => {
    expect(illegal.length + LEGAL.length).toBe(
      BOOKING_STATUSES.length * BOOKING_TRANSITIONS.length,
    );
  });

  it.each(illegal)("refuses to %s a booking that is %s", (from, transition) => {
    expect(() => applyTransition(from, transition)).toThrow(IllegalTransitionError);
  });

  it("names the state and the attempted action in the error", () => {
    try {
      applyTransition("PENDING", "refund");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(IllegalTransitionError);
      const illegalError = error as IllegalTransitionError;
      expect(illegalError.from).toBe("PENDING");
      expect(illegalError.transition).toBe("refund");
      expect(illegalError.message).toBe("Cannot refund a booking in state PENDING");
    }
  });
});

describe("the two deliberate omissions", () => {
  it("will not refund a booking that is still live", () => {
    // Refunding a CONFIRMED booking leaves the guest with their money and their
    // room, and the supplier still owed a night. Cancel first, then refund.
    expect(canTransition("CONFIRMED", "refund")).toBe(false);
    expect(applyTransition("CONFIRMED", "cancel")).toBe("CANCELLED");
    expect(applyTransition("CANCELLED", "refund")).toBe("REFUNDED");
  });

  it("will not revive a failed payment into a booking", () => {
    for (const transition of BOOKING_TRANSITIONS) {
      expect(canTransition("FAILED", transition)).toBe(false);
    }
  });
});

describe("terminal states", () => {
  it("treats REFUNDED and FAILED as ends of the line", () => {
    expect(isTerminal("REFUNDED")).toBe(true);
    expect(isTerminal("FAILED")).toBe(true);
  });

  it("treats everything else as still open", () => {
    expect(isTerminal("PENDING")).toBe(false);
    expect(isTerminal("CONFIRMED")).toBe(false);
    expect(isTerminal("CANCELLED")).toBe(false);
  });

  it("rejects every transition out of a terminal state", () => {
    for (const status of BOOKING_STATUSES.filter(isTerminal)) {
      for (const transition of BOOKING_TRANSITIONS) {
        expect(() => applyTransition(status, transition)).toThrow(IllegalTransitionError);
      }
    }
  });
});

describe("canTransition", () => {
  it("agrees with applyTransition on every cell of the matrix", () => {
    for (const from of BOOKING_STATUSES) {
      for (const transition of BOOKING_TRANSITIONS) {
        const allowed = canTransition(from, transition);
        let threw = false;
        try {
          applyTransition(from, transition);
        } catch {
          threw = true;
        }
        expect(allowed).toBe(!threw);
      }
    }
  });

  it("lets a caller be idempotent without catching exceptions", () => {
    // The M6 duplicate-webhook path: check first, no-op deliberately. Catching
    // instead would make a real double-confirm look like a harmless retry.
    const already: BookingStatus = "CONFIRMED";

    expect(canTransition(already, "confirm")).toBe(false);
    expect(already).toBe("CONFIRMED");
  });
});

describe("strictness", () => {
  it("does not treat a repeat transition as success", () => {
    // A second `confirm` means a lost update or an unguarded replay. This is the
    // layer most likely to notice, so it refuses rather than absorbing it.
    const confirmed = applyTransition("PENDING", "confirm");

    expect(() => applyTransition(confirmed, "confirm")).toThrow(IllegalTransitionError);
  });

  it("does not treat a repeat cancellation as success", () => {
    const cancelled = applyTransition("CONFIRMED", "cancel");

    expect(() => applyTransition(cancelled, "cancel")).toThrow(IllegalTransitionError);
  });
});

describe("legalTransitions", () => {
  it("lists what may be done from each state", () => {
    expect(legalTransitions("PENDING").sort()).toEqual(["cancel", "confirm", "fail"]);
    expect(legalTransitions("CONFIRMED")).toEqual(["cancel"]);
    expect(legalTransitions("CANCELLED")).toEqual(["refund"]);
    expect(legalTransitions("REFUNDED")).toEqual([]);
    expect(legalTransitions("FAILED")).toEqual([]);
  });
});

describe("isPaid", () => {
  it("is true while the money is with us", () => {
    expect(isPaid("CONFIRMED")).toBe(true);
    // Cancelled but not yet refunded: we are still holding the guest's money.
    expect(isPaid("CANCELLED")).toBe(true);
  });

  it("is false before payment and after it is returned", () => {
    expect(isPaid("PENDING")).toBe(false);
    expect(isPaid("REFUNDED")).toBe(false);
    expect(isPaid("FAILED")).toBe(false);
  });
});

describe("reachability", () => {
  it("can reach every state from PENDING", () => {
    // A state nothing can reach is dead code in a state machine.
    const reached = new Set<BookingStatus>([INITIAL_STATUS]);
    const queue: BookingStatus[] = [INITIAL_STATUS];

    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const transition of legalTransitions(current)) {
        const next = applyTransition(current, transition);
        if (!reached.has(next)) {
          reached.add(next);
          queue.push(next);
        }
      }
    }

    expect([...reached].sort()).toEqual([...BOOKING_STATUSES].sort());
  });
});
