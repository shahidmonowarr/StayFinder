/** Prisma's error code for a unique constraint violation. */
const UNIQUE_VIOLATION = "P2002";

/**
 * Which column a unique-constraint violation was about.
 *
 * Two shapes have to be read, and getting this wrong is silent: the recovery
 * path simply never runs and a conflict surfaces as a 500.
 *
 * - Prisma 7 with a driver adapter reports the columns at
 *   `meta.driverAdapterError.cause.constraint.fields`, and the names arrive
 *   **quoted** (`"quoteId"`), because they come straight from Postgres.
 * - Older Prisma (and non-adapter setups) use a flat `meta.target`.
 *
 * Exported so the shapes can be asserted directly. A test that only provokes a
 * real conflict can pass for the wrong reason — the pre-flight lookup catches
 * most races before the constraint ever fires.
 */
export function uniqueViolationFields(error: unknown): string[] {
  if (typeof error !== "object" || error === null) return [];

  const candidate = error as {
    code?: unknown;
    meta?: {
      target?: unknown;
      driverAdapterError?: { cause?: { constraint?: { fields?: unknown } } };
    };
  };
  if (candidate.code !== UNIQUE_VIOLATION) return [];

  const unquote = (field: unknown): string => String(field).replace(/^"|"$/g, "");

  const adapterFields = candidate.meta?.driverAdapterError?.cause?.constraint?.fields;
  if (Array.isArray(adapterFields)) return adapterFields.map(unquote);

  const target = candidate.meta?.target;
  if (Array.isArray(target)) return target.map(unquote);
  if (typeof target === "string") return [unquote(target)];

  return [];
}
