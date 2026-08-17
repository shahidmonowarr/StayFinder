import { createAlphaAdapter } from "./alpha";
import { createBetaAdapter } from "./beta";
import { createGammaAdapter } from "./gamma";
import type { SupplierAdapter } from "./types";

export * from "./types";
export { createAlphaAdapter, normalizeAlpha, normalizeAlphaQuote } from "./alpha";
export {
  createBetaAdapter,
  normalizeBeta,
  normalizeBetaQuote,
  parseCategory,
  toCityCode,
} from "./beta";
export {
  createGammaAdapter,
  normalizeGamma,
  normalizeGammaQuote,
  QUOTE_QUERY,
  SEARCH_QUERY,
} from "./gamma";

export interface SupplierUrls {
  alpha: string;
  beta: string;
  gamma: string;
}

/**
 * The registry. Adding a fourth supplier means one import and one line here —
 * the orchestrator and the route stay untouched.
 *
 * Order matters only for presentation: `suppliers[]` in the response follows
 * this order so the UI's status strip does not reshuffle between requests.
 */
export function createAdapters(urls: SupplierUrls): SupplierAdapter[] {
  return [
    createAlphaAdapter(urls.alpha),
    createBetaAdapter(urls.beta),
    createGammaAdapter(urls.gamma),
  ];
}
