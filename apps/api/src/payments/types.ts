/**
 * The payment provider port.
 *
 * Everything interesting about this milestone — webhook-driven confirmation,
 * duplicate absorption, signature verification, the ledger, the state
 * transitions — is provider-agnostic. Putting Stripe behind an interface is what
 * lets all of it be exercised without an account, and what keeps the parts that
 * *are* Stripe-specific down to one small file.
 */

export interface PaymentIntent {
  /** The provider's id. Stored on the booking; webhooks are matched back by it. */
  id: string;
  /** Handed to the browser to complete payment. Never a secret we can spend. */
  clientSecret: string;
  amountMinor: number;
  currency: string;
}

export interface RefundResult {
  id: string;
  amountMinor: number;
}

/**
 * The provider events this system acts on, normalized.
 *
 * Anything else a provider emits is not modelled: an unrecognized event is
 * acknowledged and ignored rather than mapped onto a state change we did not
 * intend.
 */
export type PaymentEventKind = "payment_succeeded" | "payment_failed" | "refund_succeeded";

export interface PaymentEvent {
  /**
   * The provider's own event id. This is the idempotency key for *delivery*,
   * distinct from the idempotency key a client sends when creating a booking.
   */
  id: string;
  kind: PaymentEventKind;
  /** Ties the event back to a booking. */
  paymentIntentId: string;
  amountMinor: number;
  currency: string;
  /** Present on refund events. */
  refundId?: string;
  /** The provider's own type string, kept for logging and replay. */
  rawType: string;
}

export class WebhookSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookSignatureError";
  }
}

export interface PaymentProvider {
  readonly kind: "stripe" | "fake";

  createPaymentIntent(input: {
    bookingId: string;
    amountMinor: number;
    currency: string;
    /** Sent to the provider so a double-clicked checkout cannot create two intents. */
    idempotencyKey: string;
  }): Promise<PaymentIntent>;

  refund(input: {
    paymentIntentId: string;
    amountMinor: number;
    idempotencyKey: string;
  }): Promise<RefundResult>;

  /**
   * Verify a delivery and normalize it.
   *
   * Takes the **raw bytes**, not a parsed object: the signature covers exactly
   * what was sent, and a body that has been parsed and re-serialized will not
   * match — different key order, different whitespace, and a verification that
   * fails only against the real provider.
   *
   * @returns `null` when the signature is valid but the event is one we do not
   * act on. Throws `WebhookSignatureError` when it cannot be trusted at all.
   */
  verifyWebhook(rawBody: Buffer, signature: string | undefined): PaymentEvent | null;
}
