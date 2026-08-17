import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import {
  WebhookSignatureError,
  type PaymentEvent,
  type PaymentIntent,
  type PaymentProvider,
  type RefundResult,
} from "./types";

/**
 * A payment provider that needs no account, no network, and no keys.
 *
 * It is not a stub: it implements the *same* signature scheme as Stripe —
 * `t=<unix>,v1=<hmac-sha256 of "<t>.<body>">` — so webhook verification, replay
 * rejection, and raw-body handling are all genuinely exercised rather than
 * skipped over. Swapping in the Stripe provider changes which signature is
 * checked, not whether one is.
 *
 * Payment "succeeding" is not simulated in here. Something has to *deliver* an
 * event, and pretending a background timer is a webhook would hide the very
 * thing this milestone is about — so delivery happens through the real webhook
 * endpoint, signed, via the dev route.
 */

/** How old a signed delivery may be. Beyond this it is treated as a replay. */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

export interface FakeProviderOptions {
  webhookSecret: string;
  /** Injectable so signature-expiry can be tested without waiting five minutes. */
  now?: () => number;
  /** Injectable so generated ids are stable in tests that assert on them. */
  newId?: (prefix: string) => string;
}

function defaultId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 24)}`;
}

/** `t=<unix>,v1=<hex>`, the same shape Stripe sends. */
export function signPayload(secret: string, payload: string, timestampSeconds: number): string {
  const signature = createHmac("sha256", secret)
    .update(`${timestampSeconds}.${payload}`)
    .digest("hex");
  return `t=${timestampSeconds},v1=${signature}`;
}

function parseSignature(header: string): { timestamp: number; signature: string } | null {
  let timestamp: number | undefined;
  let signature: string | undefined;

  for (const part of header.split(",")) {
    const [key, value] = part.split("=", 2);
    if (key?.trim() === "t" && value !== undefined) timestamp = Number(value);
    if (key?.trim() === "v1" && value !== undefined) signature = value;
  }

  if (timestamp === undefined || Number.isNaN(timestamp) || signature === undefined) return null;
  return { timestamp, signature };
}

/** Constant-time compare. A fast-exiting `===` leaks the signature a byte at a time. */
function signaturesMatch(expected: string, actual: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(actual, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** The event body the dev route sends and this provider parses. */
export interface FakeEventPayload {
  id: string;
  type: string;
  data: {
    paymentIntentId: string;
    amountMinor: number;
    currency: string;
    refundId?: string;
  };
}

const KIND_BY_TYPE: Record<string, PaymentEvent["kind"]> = {
  "payment_intent.succeeded": "payment_succeeded",
  "payment_intent.payment_failed": "payment_failed",
  "charge.refunded": "refund_succeeded",
};

export class FakePaymentProvider implements PaymentProvider {
  readonly kind = "fake" as const;

  private readonly webhookSecret: string;
  private readonly now: () => number;
  private readonly newId: (prefix: string) => string;

  constructor(options: FakeProviderOptions) {
    this.webhookSecret = options.webhookSecret;
    this.now = options.now ?? (() => Date.now());
    this.newId = options.newId ?? defaultId;
  }

  /**
   * Intents are derived from the idempotency key rather than random, which is
   * how the fake honours the same promise Stripe does: asking twice with one key
   * returns one intent instead of charging twice.
   */
  private readonly intents = new Map<string, PaymentIntent>();

  createPaymentIntent(input: {
    bookingId: string;
    amountMinor: number;
    currency: string;
    idempotencyKey: string;
  }): Promise<PaymentIntent> {
    const existing = this.intents.get(input.idempotencyKey);
    if (existing !== undefined) return Promise.resolve(existing);

    const id = this.newId("pi");
    const intent: PaymentIntent = {
      id,
      clientSecret: `${id}_secret_${this.newId("cs")}`,
      amountMinor: input.amountMinor,
      currency: input.currency,
    };
    this.intents.set(input.idempotencyKey, intent);
    return Promise.resolve(intent);
  }

  private readonly refunds = new Map<string, RefundResult>();

  refund(input: {
    paymentIntentId: string;
    amountMinor: number;
    idempotencyKey: string;
  }): Promise<RefundResult> {
    const existing = this.refunds.get(input.idempotencyKey);
    if (existing !== undefined) return Promise.resolve(existing);

    const result: RefundResult = { id: this.newId("re"), amountMinor: input.amountMinor };
    this.refunds.set(input.idempotencyKey, result);
    return Promise.resolve(result);
  }

  verifyWebhook(rawBody: Buffer, signature: string | undefined): PaymentEvent | null {
    if (signature === undefined || signature === "") {
      throw new WebhookSignatureError("Missing signature header");
    }

    const parsed = parseSignature(signature);
    if (parsed === null) {
      throw new WebhookSignatureError("Malformed signature header");
    }

    const ageSeconds = Math.abs(Math.floor(this.now() / 1000) - parsed.timestamp);
    if (ageSeconds > SIGNATURE_TOLERANCE_SECONDS) {
      // A valid signature is valid forever without this. Rejecting stale
      // timestamps is what stops a captured delivery being replayed tomorrow.
      throw new WebhookSignatureError("Signature timestamp is outside the tolerance window");
    }

    const body = rawBody.toString("utf8");
    const expected = signPayload(this.webhookSecret, body, parsed.timestamp);
    if (!signaturesMatch(expected, signature)) {
      throw new WebhookSignatureError("Signature does not match the payload");
    }

    let payload: FakeEventPayload;
    try {
      payload = JSON.parse(body) as FakeEventPayload;
    } catch {
      throw new WebhookSignatureError("Signed payload is not valid JSON");
    }

    const kind = KIND_BY_TYPE[payload.type];
    if (kind === undefined) {
      // Signed and genuine, but not an event we act on. Acknowledged upstream.
      return null;
    }

    return {
      id: payload.id,
      kind,
      paymentIntentId: payload.data.paymentIntentId,
      amountMinor: payload.data.amountMinor,
      currency: payload.data.currency,
      ...(payload.data.refundId === undefined ? {} : { refundId: payload.data.refundId }),
      rawType: payload.type,
    };
  }
}
