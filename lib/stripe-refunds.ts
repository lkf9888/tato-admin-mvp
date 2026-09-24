import "server-only";

import type Stripe from "stripe";

import { getStripeClient } from "@/lib/stripe";

/**
 * Refund a direct-booking charge, taking the money back from the host.
 *
 * Direct bookings are destination charges: the charge lives on the
 * platform account and the full amount is transferred to the host's
 * Connect account the moment it is captured. A plain `refunds.create`
 * on such a charge sends the renter's money back *out of the
 * platform's balance* and leaves the host's transfer where it is --
 * Stripe's documented default, and the opposite of what anyone means
 * by "the host refunds the renter". Every refund in this app used to
 * be that, so every cancellation was quietly paid for by the platform.
 *
 * `reverse_transfer` pulls the refunded amount back from the host.
 * Because the transfer is the whole charge (the platform fee is a
 * separate application fee transferred back afterwards), a partial
 * reversal is proportional to the charge and therefore equals the
 * refund exactly -- a $300 deposit refund reverses $300, not $291.
 *
 * `refundPlatformFee` decides whether the platform also gives back a
 * proportional share of its 5%. Yes when the booking is being undone;
 * no for a deposit, which was never in the fee base to begin with.
 *
 * Charges with no transfer on them -- paid before Connect was wired
 * in, or a payment Stripe skipped the transfer for -- fall back to a
 * plain refund, since `reverse_transfer` is an error there and the
 * money genuinely is on the platform.
 */
export async function refundDirectBookingCharge(input: {
  paymentIntentId: string;
  /** Dollars. Omitted refunds the whole charge. */
  amount?: number;
  refundPlatformFee: boolean;
  metadata?: Record<string, string>;
  /** Makes a retried call -- a double click, a webhook redelivery --
   *  return the first refund instead of issuing a second one. */
  idempotencyKey?: string;
}): Promise<Stripe.Refund> {
  const stripe = getStripeClient();
  const intent = await stripe.paymentIntents.retrieve(input.paymentIntentId, {
    expand: ["latest_charge"],
  });
  const charge =
    intent.latest_charge && typeof intent.latest_charge !== "string"
      ? intent.latest_charge
      : null;
  const hasTransfer = Boolean(charge?.transfer);

  return stripe.refunds.create(
    {
      payment_intent: input.paymentIntentId,
      amount: input.amount == null ? undefined : Math.round(input.amount * 100),
      reason: "requested_by_customer",
      reverse_transfer: hasTransfer ? true : undefined,
      // Stripe refuses a fee refund on a destination charge unless the
      // transfer is reversed too, so the two travel together.
      refund_application_fee:
        hasTransfer && charge?.application_fee ? input.refundPlatformFee : undefined,
      metadata: input.metadata,
    },
    input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : undefined,
  );
}

/**
 * What the checkout webhook stamped on a direct booking: whether it is
 * one, the PaymentIntent it was paid with, and where the renter reads
 * mail. All null on an order that never came through a public page.
 */
export function readDirectBookingPayment(sourceMetadata: string | null) {
  const empty = { isDirectBooking: false, paymentIntentId: null, renterEmail: null };
  if (!sourceMetadata) return empty;
  try {
    const parsed = JSON.parse(sourceMetadata) as {
      channel?: string;
      stripePaymentIntent?: string | null;
      renterEmail?: string | null;
    };
    return {
      isDirectBooking: parsed.channel === "direct-booking",
      paymentIntentId: parsed.stripePaymentIntent ?? null,
      renterEmail: parsed.renterEmail ?? null,
    };
  } catch {
    return empty;
  }
}
