import "server-only";

import { OrderStatus } from "@prisma/client";

import { readDirectBookingPayment } from "@/lib/stripe-refunds";

/**
 * Whether cancelling this order by a status change or a delete would
 * skip the renter's refund.
 *
 * A direct booking the renter paid for online is cancelled through the
 * cancel-and-refund panel, which refunds first and only then cancels.
 * Every other path that sets `cancelled` -- the status dropdown, delete,
 * the orders page's forms -- just flips the order, and the money stays
 * with the host without anyone having seen the choice. So those paths
 * refuse, and the caller points the operator at the panel.
 *
 * An order already cancelled is past that decision: deleting it after
 * the panel has run (to move it to the trash) is allowed.
 */
export function blocksPlainCancel(order: {
  status: OrderStatus;
  sourceMetadata: string | null;
}) {
  if (order.status === OrderStatus.cancelled) return false;
  const payment = readDirectBookingPayment(order.sourceMetadata);
  return payment.isDirectBooking && Boolean(payment.paymentIntentId);
}

/** The error code the API returns when `blocksPlainCancel` refuses. */
export const PAID_DIRECT_BOOKING = "PAID_DIRECT_BOOKING";
