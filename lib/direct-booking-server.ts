import "server-only";

import { OrderAttachmentKind } from "@prisma/client";
import type Stripe from "stripe";

import {
  dateOnlyToUtcMidday,
  getDirectBookingInstalmentPlan,
  hasVehicleBookingConflict,
} from "@/lib/direct-booking";
import { mintRenterToken } from "@/lib/booking-access";
import { getBookingPolicyForVehicle } from "@/lib/booking-policy-server";
import { sendDirectBookingConfirmationEmail } from "@/lib/direct-booking-email";
import {
  buildRentalAgreementValues,
  createRentalAgreementEnvelope,
} from "@/lib/rental-agreement";
import { getAppUrl } from "@/lib/stripe";
import { logActivity, reconcileVehicleConflicts } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import { getStripeClient } from "@/lib/stripe";
import { roundCurrencyAmount } from "@/lib/utils";

type DirectBookingMetadata = {
  vehicleId?: string;
  isInstalmentPlan?: string;
  contractTotal?: string;
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
  taxName?: string;
  taxRate?: string;
  taxAmount?: string;
  licenseDraftId?: string;
  agreementAccepted?: string;
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

/**
 * How the contract refers to the card, without holding any of it.
 *
 * Stripe's checkout session carries the brand and last four digits
 * once payment succeeds. That is enough for a clause about subsequent
 * charges and is the most that may be written down.
 */
function describeStripePaymentMethod(session: Stripe.Checkout.Session) {
  const card =
    typeof session.payment_intent === "string"
      ? null
      : session.payment_intent?.payment_method &&
          typeof session.payment_intent.payment_method !== "string"
        ? session.payment_intent.payment_method.card
        : null;

  if (card?.brand && card.last4) {
    return `${card.brand.toUpperCase()} ending ${card.last4} (held by Stripe)`;
  }
  return "Card on file with Stripe";
}

/**
 * Write the instalments a long booking owes.
 *
 * The first row is what Stripe actually took, not what the plan said
 * it would: those agree, but if a rate changed in the seconds between
 * checkout and this webhook, the paid row should say what was paid.
 * The later rows carry the schedule and no `paidAt`, which is what
 * makes them show up as outstanding.
 */
async function writeInstalmentSchedule(input: {
  order: { id: string; workspaceId: string | null };
  vehicle: {
    workspaceId: string | null;
    bookingDailyRate: number | null;
    bookingInsuranceFee: number | null;
    bookingDepositAmount: number | null;
    bookingTaxRate: number | null;
    bookingWeeklyDiscountPercent: number | null;
    bookingMinimumRentalDays: number | null;
    bookingDailyKmAllowance: number | null;
    bookingExtraKmRate: number | null;
  };
  pickupDate: string;
  returnDate: string;
  includeInsurance: boolean;
  chargedAmount: number | null;
}) {
  const existing = await prisma.orderPayment.count({ where: { orderId: input.order.id } });
  if (existing > 0) return;

  const policy = await getBookingPolicyForVehicle(input.vehicle);
  const plan = getDirectBookingInstalmentPlan({
    pickupDate: input.pickupDate,
    returnDate: input.returnDate,
    weeklyDiscountPercent: policy.weeklyDiscountPercent,
    bookingDailyRate: input.vehicle.bookingDailyRate ?? 0,
    bookingInsuranceFee: input.vehicle.bookingInsuranceFee ?? 0,
    bookingDepositAmount: input.vehicle.bookingDepositAmount ?? 0,
    bookingTaxRate: input.vehicle.bookingTaxRate ?? 0,
    includeInsurance: input.includeInsurance,
  });
  if (!plan.isInstalmentPlan) return;

  const now = new Date();
  await prisma.orderPayment.createMany({
    data: plan.instalments.map((instalment) => {
      const isFirst = instalment.index === 1;
      return {
        workspaceId: input.order.workspaceId,
        orderId: input.order.id,
        amount:
          isFirst && input.chargedAmount != null ? input.chargedAmount : instalment.total,
        paidAt: isFirst ? now : null,
        dueAt: dateOnlyToUtcMidday(instalment.dueDate),
        method: isFirst ? "Stripe" : null,
        note: `Period ${instalment.index} of ${plan.instalments.length} · ${instalment.days} day(s) from ${instalment.startDate}`,
        createdBy: "direct-booking",
      };
    }),
  });

  // The schedule is recomputed here from the vehicle's current rates,
  // while the card was charged from the rates at checkout. Those agree
  // in every ordinary case; if a rate was edited in the seconds
  // between, the paid row says what was actually taken and the rows
  // then no longer sum to the order's value. That is the honest
  // recording, but it must not be a silent one.
  const chargedDrift =
    input.chargedAmount != null &&
    Math.abs(input.chargedAmount - plan.instalments[0].total) > 0.01;

  await logActivity({
    workspaceId: input.order.workspaceId ?? undefined,
    actor: "stripe-webhook",
    action: chargedDrift
      ? "direct_booking_instalments_mismatch"
      : "direct_booking_instalments_created",
    entityType: "Order",
    entityId: input.order.id,
    metadata: {
      periods: plan.instalments.length,
      dueNow: plan.dueNow,
      dueLater: plan.dueLater,
      ...(chargedDrift
        ? { chargedAmount: input.chargedAmount, expectedFirstPeriod: plan.instalments[0].total }
        : {}),
    },
  });
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

  const chargedAmount =
    typeof session.amount_total === "number" ? roundCurrencyAmount(session.amount_total / 100) : null;
  const isInstalmentPlan = metadata.isInstalmentPlan === "true";
  const contractTotal = metadata.contractTotal ? Number(metadata.contractTotal) : null;

  // On an instalment plan the card was only charged for the first
  // period, but the order is worth the whole booking. Recording the
  // charge as `totalPrice` would understate every revenue figure in
  // the app and hide the fact that money is still owed -- which is
  // exactly what OrderPayment rows exist to answer.
  const totalPrice =
    isInstalmentPlan && contractTotal != null && Number.isFinite(contractTotal)
      ? roundCurrencyAmount(contractTotal)
      : chargedAmount;
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
      depositAmount: roundCurrencyAmount(
        depositAmount && !Number.isNaN(depositAmount) ? depositAmount : null,
      ),
      status: "booked",
      createdBy: "direct-booking",
      // The renter's own link. Minted here rather than on demand so
      // it can go into the confirmation that is about to be sent.
      renterToken: mintRenterToken(),
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
        taxName: metadata.taxName || null,
        taxRate: metadata.taxRate ? Number(metadata.taxRate) : null,
        taxAmount: metadata.taxAmount ? Number(metadata.taxAmount) : null,
        licenseDraftId: metadata.licenseDraftId || null,
        agreementAccepted: metadata.agreementAccepted === "true",
      }),
    },
  });

  const licenseDocuments = await prisma.directBookingDocument.findMany({
    where: { checkoutSessionId: session.id },
    orderBy: { createdAt: "asc" },
  });

  if (licenseDocuments.length > 0) {
    await prisma.orderAttachment.createMany({
      data: licenseDocuments.map((document) => ({
        workspaceId: vehicle.workspaceId,
        orderId: order.id,
        vehicleId,
        kind: OrderAttachmentKind.document,
        pathname: document.pathname,
        filename:
          document.kind === "driver_license_front"
            ? `driver-license-front-${document.filename ?? "upload"}`
            : `driver-license-back-${document.filename ?? "upload"}`,
        contentType: document.contentType,
        size: document.size,
      })),
    });

    await prisma.directBookingDocument.updateMany({
      where: { checkoutSessionId: session.id },
      data: { orderId: order.id },
    });
  }

  if (isInstalmentPlan) {
    await writeInstalmentSchedule({
      order,
      vehicle,
      pickupDate,
      returnDate,
      includeInsurance: metadata.includeInsurance === "true",
      chargedAmount,
    });
  }

  await reconcileVehicleConflicts(vehicleId);

  // After the order exists and the host has been paid. The sender
  // swallows its own failures: a mail outage here must not fail the
  // webhook, because Stripe would retry it and we would be deciding
  // all over again whether an order we already created is a duplicate.
  const confirmationEmail = renterEmail ?? session.customer_details?.email ?? null;

  await sendDirectBookingConfirmationEmail({
    workspaceId: vehicle.workspaceId,
    order,
    vehicle,
    renterEmail: confirmationEmail,
  });

  // The rental agreement, prefilled and sent for signature. Swallows
  // its own failures for the same reason the confirmation does: the
  // booking is already paid for, and an unsent contract is something
  // to chase rather than a reason for Stripe to retry the webhook.
  await createRentalAgreementEnvelope({
    workspaceId: vehicle.workspaceId,
    orderId: order.id,
    renterName,
    renterEmail: confirmationEmail,
    values: buildRentalAgreementValues({
      renterName,
      renterPhone: metadata.renterPhone,
      renterEmail: confirmationEmail,
      vehicle,
      pickupDatetime: order.pickupDatetime,
      returnDatetime: order.returnDatetime,
      totalPrice: order.totalPrice,
      depositAmount: order.depositAmount,
      insuranceAmount:
        metadata.includeInsurance === "true" && metadata.bookedDays
          ? (vehicle.bookingInsuranceFee ?? 0) * Number(metadata.bookedDays)
          : null,
      // The card itself stays with Stripe. What the contract records
      // is that one is on file, which is what its payment clause
      // actually needs -- storing the number would be a PCI matter and
      // storing the CVV is prohibited outright.
      paymentMethodOnFile: describeStripePaymentMethod(session),
      policy: await getBookingPolicyForVehicle(vehicle),
    }),
    appUrl: getAppUrl(),
  });

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
