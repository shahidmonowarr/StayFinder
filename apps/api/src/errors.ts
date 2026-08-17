/**
 * Turning a thrown value into something an operator can act on.
 *
 * Node's `fetch` reports every transport failure as the same useless
 * `TypeError: fetch failed` and hides what actually happened in `cause`. Anyone
 * reading a supplier status or a 502 body needs "connect ECONNREFUSED
 * 127.0.0.1:4001", not "fetch failed" — the first names the problem, the second
 * only confirms there is one.
 *
 * This lives on its own because both the search fan-out and the quote route need
 * it. They report failures very differently — one into a status field, one into
 * an HTTP error body — but "what actually went wrong" is the same question.
 */

/**
 * Pull a usable detail out of an error's `cause`.
 *
 * Two shapes have to be handled, both of them Node's doing:
 *
 * - A plain `Error` cause, which happens when the host is a literal IP.
 * - An `AggregateError` **with an empty message**, which happens when the host
 *   is `localhost`: it resolves to both `::1` and `127.0.0.1`, undici attempts
 *   both, and collects the two failures. Reading `.message` on that gives ""
 *   and silently loses the reason.
 */
export function causeDetail(cause: unknown): string | undefined {
  if (!(cause instanceof Error)) return undefined;
  if (cause.message !== "") return cause.message;
  if (cause instanceof AggregateError) {
    return cause.errors.find(
      (inner: unknown): inner is Error => inner instanceof Error && inner.message !== "",
    )?.message;
  }
  return undefined;
}

/** An error message with one level of `cause` unwrapped onto it. */
export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return "Unknown error";
  const detail = causeDetail((error as { cause?: unknown }).cause);
  return detail === undefined ? error.message : `${error.message}: ${detail}`;
}
