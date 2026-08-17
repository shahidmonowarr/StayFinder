import { FakePaymentProvider } from "./fake";
import type { PaymentProvider } from "./types";

export * from "./types";
export { FakePaymentProvider, signPayload, type FakeEventPayload } from "./fake";
export { normalizeStripeEvent, StripePaymentProvider } from "./stripe";

/**
 * Pick a payment provider.
 *
 * Without a secret key this is the fake: no account, no network, and the demo
 * still shows the whole webhook-driven flow. `stripe` is imported dynamically so
 * that path never loads it.
 */
export async function createPaymentProvider(config: {
  secretKey: string | undefined;
  webhookSecret: string;
}): Promise<PaymentProvider> {
  if (config.secretKey === undefined || config.secretKey === "") {
    console.info("[api] payments: fake provider (set STRIPE_SECRET_KEY to use Stripe test mode)");
    return new FakePaymentProvider({ webhookSecret: config.webhookSecret });
  }

  const { default: Stripe } = await import("stripe");
  const { StripePaymentProvider } = await import("./stripe");
  console.info("[api] payments: stripe");
  return new StripePaymentProvider(new Stripe(config.secretKey), config.webhookSecret);
}
