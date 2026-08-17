"use client";

import { formatMoney, legalTransitions, type BookingStatus } from "@stayfinder/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Checkout and cancellation.
 *
 * Nothing here decides an outcome. Starting checkout creates a payment intent;
 * the booking becomes CONFIRMED only when the *webhook* says so. The panel
 * refreshes the server-rendered page rather than asserting a result locally —
 * if the redirect and the webhook race, the webhook is what wins.
 */

interface Props {
  bookingId: string;
  status: BookingStatus;
  apiUrl: string;
  /** True when the API is running the fake provider and can deliver its own events. */
  simulated: boolean;
}

async function post(url: string, body?: unknown): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

export function PaymentPanel({ bookingId, status, apiUrl, simulated }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [intentId, setIntentId] = useState<string | null>(null);
  const [lastEventId, setLastEventId] = useState<string | null>(null);

  const canPay = legalTransitions(status).includes("confirm");
  const canCancel = legalTransitions(status).includes("cancel");

  async function run(label: string, work: () => Promise<string>) {
    setBusy(label);
    setNote(null);
    try {
      setNote(await work());
    } catch (error) {
      setNote(error instanceof Error ? error.message : "Something went wrong");
    } finally {
      setBusy(null);
      router.refresh();
    }
  }

  const startCheckout = () =>
    run("checkout", async () => {
      const response = await post(`${apiUrl}/api/bookings/${bookingId}/payment-intent`);
      const body = (await response.json()) as { paymentIntentId?: string; message?: string };
      if (!response.ok) throw new Error(body.message ?? "Could not start checkout");
      setIntentId(body.paymentIntentId ?? null);
      return "Payment intent created. The booking is still PENDING — only a webhook can confirm it.";
    });

  const deliver = (type: string, eventId?: string) =>
    run(type, async () => {
      const response = await post(`${apiUrl}/api/dev/payment-events`, {
        bookingId,
        type,
        ...(eventId === undefined ? {} : { eventId }),
      });
      const body = (await response.json()) as {
        outcome?: string;
        delivered?: string;
        message?: string;
      };
      if (!response.ok) throw new Error(body.message ?? "Delivery failed");
      if (body.delivered !== undefined) setLastEventId(body.delivered);
      return `Webhook delivered — outcome: ${body.outcome}`;
    });

  const cancel = () =>
    run("cancel", async () => {
      const response = await post(`${apiUrl}/api/bookings/${bookingId}/cancel`);
      const body = (await response.json()) as { refundRequested?: boolean; message?: string };
      if (!response.ok) throw new Error(body.message ?? "Could not cancel");
      return body.refundRequested === true
        ? "Cancelled, refund requested. It stays CANCELLED until the refund webhook lands."
        : "Cancelled. Nothing had been charged, so there is nothing to refund.";
    });

  return (
    <div className="rounded border border-line bg-card p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="font-mono text-[10px] font-semibold tracking-[0.11em] text-muted uppercase">
          Payment
        </h2>
        <p className="font-mono text-[10.5px] text-muted">
          provider: {simulated ? "fake (no Stripe account needed)" : "stripe test mode"}
        </p>
      </div>

      <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
        Confirmation is webhook-driven, never redirect-driven. A browser can be closed, blocked, or
        lose the tab; the webhook is the only delivery the provider retries.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!canPay || busy !== null}
          onClick={startCheckout}
          className="rounded-[3px] bg-accent px-3 py-1.5 text-[12.5px] font-medium text-white disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {busy === "checkout" ? "Starting…" : "Start checkout"}
        </button>

        {simulated && (
          <>
            <button
              type="button"
              disabled={intentId === null || busy !== null}
              onClick={() => deliver("payment_intent.succeeded")}
              className="rounded-[3px] border border-line bg-card px-3 py-1.5 text-[12.5px] disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Deliver payment succeeded
            </button>
            <button
              type="button"
              disabled={intentId === null || busy !== null}
              onClick={() => deliver("payment_intent.payment_failed")}
              className="rounded-[3px] border border-line bg-card px-3 py-1.5 text-[12.5px] disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Deliver payment failed
            </button>
            <button
              type="button"
              disabled={lastEventId === null || busy !== null}
              onClick={() => deliver("payment_intent.succeeded", lastEventId ?? undefined)}
              className="rounded-[3px] border border-warn/60 bg-warn/5 px-3 py-1.5 text-[12.5px] text-warn disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              title="Sends the exact same event id again"
            >
              Redeliver the last event
            </button>
          </>
        )}

        <button
          type="button"
          disabled={!canCancel || busy !== null}
          onClick={cancel}
          className="ml-auto rounded-[3px] border border-line bg-card px-3 py-1.5 text-[12.5px] disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {busy === "cancel" ? "Cancelling…" : "Cancel booking"}
        </button>
      </div>

      {status === "CANCELLED" && simulated && (
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => deliver("charge.refunded")}
          className="mt-2 rounded-[3px] border border-line bg-card px-3 py-1.5 text-[12.5px] disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Deliver refund succeeded
        </button>
      )}

      {note !== null && <p className="mt-3 text-[12.5px] text-muted">{note}</p>}

      {simulated && (
        <p className="mt-3 text-[11.5px] leading-relaxed text-muted">
          The simulated deliveries are signed and go through the real webhook endpoint — signature
          check and all. <strong>Redeliver the last event</strong> sends the identical event id: the
          booking does not change, and no second charge appears in the ledger.
        </p>
      )}
    </div>
  );
}

/** Formats an amount for the button label without pulling in the whole Money type. */
export function amountLabel(amountMinor: number, currency: string): string {
  return formatMoney({ amountMinor, currency });
}
