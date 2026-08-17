/**
 * Environment is read once, here, and validated on boot — a missing supplier
 * URL should crash the process at startup, not surface as a confusing fan-out
 * error under load.
 */

function port(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`${name} must be a valid port number, got "${raw}"`);
  }
  return parsed;
}

function url(name: string, fallback: string): string {
  const raw = process.env[name] ?? fallback;
  try {
    return new URL(raw).origin;
  } catch {
    throw new Error(`${name} must be a valid URL, got "${raw}"`);
  }
}

export const env = {
  port: port("API_PORT", 4000),
  suppliers: {
    alpha: url("SUPPLIER_ALPHA_URL", "http://localhost:4001"),
    beta: url("SUPPLIER_BETA_URL", "http://localhost:4002"),
    gamma: url("SUPPLIER_GAMMA_URL", "http://localhost:4003"),
  },
  /**
   * Hard per-supplier deadline for the search fan-out (M3). A slow supplier
   * must never hold the whole response hostage.
   */
  supplierTimeoutMs: 1500,
} as const;
