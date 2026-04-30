import "server-only";

import type Stripe from "stripe";

import { dateOnlyToUtcMidday, hasVehicleBookingConflict } from "@/lib/direct-booking";
import { logActivity, reconcileVehicleConflicts } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import { getStripeClient } from "@/lib/stripe";

type DirectBookingMetadata = {
  vehicleId?: string;
  vehiclePlateNumber?: string;
  vehicleName?: string;
  pickupDate?: string;
  returnDate?: string;
  renterName?: string;
  renterEmail?: string;
  renterPhone?: string;
  includeInsurance?: string;
  bookedDays?: string;
  depositAmount?: string;
};

function readMetadata(raw: Stripe.Metadata | null | undefined): DirectBookingMetadata {
  if (!raw) return {};
  return raw as DirectBookingMetadata;
}

async function refundCheckoutSession(session: Stripe.Checkout.Session, reason: string) {
  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id;

  if (!paymentIntentId) return null;

  const stripe = getStripeClient();
  try {
    const refund = await stripe.refunds.create({
      payment_intent: paymentIntentId,
      reason: "requested_by_customer",
      metadata: { reason },
    });
    return refund.id;
  } catch (error) {
    await logActivity({
      actor: "stripe-webhook",
      action: "direct_booking_refund_failed",
      entityType: "CheckoutSession",
      entityId: session.id,
      metadata: {
        reason,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    return null;
  }
}

export async function persistDirectBookingFromCheckoutSession(session: Stripe.Checkout.Session) {
  if (session.mode !== "payment") return;
  if (session.payment_status !== "paid") return;

  const metadata = readMetadata(session.metadata);
  const { vehicleId, pickupDate, returnDate, renterName, renterEmail } = metadata;

  if (!vehicleId || !pickupDate || !returnDate || !renterName) {
    await logActivity({
      actor: "stripe-webhook",
      action: "direct_booking_metadata_missing",
      entityType: "CheckoutSession",
      entityId: session.id,
      metadata: { reason: "required direct booking fields missing from session metadata" },
    });
    return;
  }

  const existing = await prisma.order.findFirst({
    where: {
      source: "offline",
      externalOrderId: session.id,
    },
    select: { id: true },
  });

  if (existing) return;

  const vehicle = await prisma.vehicle.findUnique({
    where: { id: vehicleId },
    include: {
      orders: {
        where: { isArchived: false, status: { not: "cancelled" } },
        select: { pickupDatetime: true, returnDatetime: true, status: true, isArchived: true },
      },
    },
  });

  if (!vehicle) {
    const refundId = await refundCheckoutSession(session, "vehicle_missing");
    await logActivity({
      actor: "stripe-webhook",
      action: "direct_booking_vehicle_missing",
      entityType: "CheckoutSession",
      entityId: session.id,
      metadata: { vehicleId, refundId },
    });
    return;
  }

  // The vehicle must belong to a workspace so the resulting Order is
  // visible on calendar / dashboard / orders / share pages, all of which
  // filter by workspaceId. A null workspaceId would leave the booking
  // orphaned — the host has been paid but the order is invisible.
  if (!vehicle.workspaceId) {
    const refundId = await refundCheckoutSession(session, "vehicle_workspace_missing");
    await logActivity({
      actor: "stripe-webhook",
      action: "direct_booking_workspace_missing",
      entityType: "CheckoutSession",
      entityId: session.id,
      metadata: { vehicleId, refundId },
    });
    return;
  }

  if (hasVehicleBookingConflict(vehicle.orders, pickupDate, returnDate)) {
    const refundId = await refundCheckoutSession(session, "booking_conflict");
    await logActivity({
      actor: "stripe-webhook",
      action: "direct_booking_conflict_refunded",
      entityType: "Vehicle",
      entityId: vehicleId,
      metadata: {
        sessionId: session.id,
        pickupDate,
        returnDate,
        renterName,
        renterEmail,
        refundId,
      },
    });
    return;
  }

  const totalPrice =
    typeof session.amount_total === "number" ? session.amount_total / 100 : null;
  const depositAmount = metadata.depositAmount ? Number(metadata.depositAmount) : null;

  const order = await prisma.order.create({
    data: {
      workspaceId: vehicle.workspaceId,
      vehicleId,
      source: "offline",
      externalOrderId: session.id,
      renterName,
      renterPhone: metadata.renterPhone || null,
      pickupDatetime: dateOnlyToUtcMidday(pickupDate),
      returnDatetime: dateOnlyToUtcMidday(returnDate),
      totalPrice,
      depositAmount: depositAmount && !Number.isNaN(depositAmount) ? depositAmount : null,
      status: "booked",
      createdBy: "direct-booking",
      sourceMetadata: JSON.stringify({
        channel: "direct-booking",
        stripeCheckoutSessionId: session.id,
        stripePaymentIntent:
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : session.payment_intent?.id ?? null,
        renterEmail: renterEmail ?? null,
        includeInsurance: metadata.includeInsurance === "true",
        bookedDays: metadata.bookedDays ? Number(metadata.bookedDays) : null,
      }),
    },
  });

  await reconcileVehicleConflicts(vehicleId);

  await logActivity({
    actor: "stripe-webhook",
    action: "direct_booking_order_created",
    entityType: "Order",
    entityId: order.id,
    metadata: {
      vehicleId,
      sessionId: session.id,
      pickupDate,
      returnDate,
      totalPrice,
    },
  });
}
