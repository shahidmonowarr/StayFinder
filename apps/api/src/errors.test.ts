import { describe, expect, it } from "vitest";
import { causeDetail, describeError } from "./errors";

/**
 * Both the search fan-out and the quote route report supplier failures, and both
 * need the real reason rather than Node's generic wrapper. These assert the two
 * shapes Node actually produces, captured from live failures.
 */
describe("describeError", () => {
  it("unwraps a plain Error cause, which is what a literal IP produces", () => {
    const wrapped = new TypeError("fetch failed");
    (wrapped as { cause?: unknown }).cause = new Error("connect ECONNREFUSED 127.0.0.1:4001");

    expect(describeError(wrapped)).toBe("fetch failed: connect ECONNREFUSED 127.0.0.1:4001");
  });

  it("unwraps an AggregateError cause, which is what `localhost` produces", () => {
    // `localhost` resolves to both ::1 and 127.0.0.1, so undici tries both and
    // wraps the pair in an AggregateError whose own message is the empty string.
    // Reading `.message` on it loses the reason entirely.
    const wrapped = new TypeError("fetch failed");
    (wrapped as { cause?: unknown }).cause = new AggregateError([
      new Error("connect ECONNREFUSED ::1:4001"),
      new Error("connect ECONNREFUSED 127.0.0.1:4001"),
    ]);

    expect(describeError(wrapped)).toBe("fetch failed: connect ECONNREFUSED ::1:4001");
  });

  it("falls back to the outer message when there is no usable cause", () => {
    expect(describeError(new Error("plain failure"))).toBe("plain failure");
  });

  it("falls back when the aggregate carries nothing readable", () => {
    const wrapped = new TypeError("fetch failed");
    (wrapped as { cause?: unknown }).cause = new AggregateError([]);

    expect(describeError(wrapped)).toBe("fetch failed");
  });

  it("survives a thrown value that is not an Error at all", () => {
    expect(describeError("just a string")).toBe("Unknown error");
    expect(describeError(undefined)).toBe("Unknown error");
  });
});

describe("causeDetail", () => {
  it("ignores a cause that is not an Error", () => {
    expect(causeDetail("nope")).toBeUndefined();
    expect(causeDetail(undefined)).toBeUndefined();
  });
});
