import "server-only";

import { OrderAttachmentKind } from "@prisma/client";
import type Stripe from "stripe";

import {
  dateOnlyToUtcMidday,
  getDirectBookingInstalmentPlan,
  hasTimedBookingConflict,
} from "@/lib/direct-booking";
import { mintRenterToken } from "@/lib/booking-access";
import { isBookingTime, zonedDateTimeToUtc } from "@/lib/booking-time";
import { isCouponKind, type CouponDiscount } from "@/lib/booking-coupons";
import { redeemCoupon } from "@/lib/booking-coupons-server";
import { getBookingPolicyForVehicle } from "@/lib/booking-policy-server";
import { resolveVehicleDailyRate } from "@/lib/vehicle-pricing";
import {
  buildSeasonalRateMap,
  getBookingWindowDayKeys,
  getRateSeasonality,
} from "@/lib/rental-estimate/rate-seasonality-server";
import { loadPriceOverridesForBooking } from "@/lib/vehicle-price-overrides";
import { sendDirectBookingConfirmationEmail } from "@/lib/direct-booking-email";
import {
  buildRentalAgreementValues,
  createRentalAgreementEnvelope,
} from "@/lib/rental-agreement";
import { getAppUrl } from "@/lib/stripe";
import { logActivity, reconcileVehicleConflicts } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import { refundDirectBookingCharge } from "@/lib/stripe-refunds";
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
  /** JSON `[{ name, rate, amount }]`, one entry per tax. */
  taxLines?: string;
  couponCode?: string;
  couponKind?: string;
  couponValue?: string;
  couponAmount?: string;
  /** The insurance rate charged per day (BC or non-BC licence). */
  insuranceDailyRate?: string;
  hasLocalLicence?: string;
  /** `HH:MM` on the operator's clock; absent on sessions made before times. */
  pickupTime?: string;
  returnTime?: string;
  pickupLocation?: string;
  returnLocation?: string;
  locationFeeAmount?: string;
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

  try {
    // A booking we could not honour: the renter gets everything back,
    // the host gives back what was transferred, and the platform gives
    // back its fee -- nobody earns on a trip that never existed. Keyed
    // on the session so a redelivered webhook cannot refund twice.
    const refund = await refundDirectBookingCharge({
      paymentIntentId,
      refundPlatformFee: true,
      metadata: { reason },
      idempotencyKey: `checkout-refund:${session.id}`,
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
    id: string;
    workspaceId: string | null;
    brand: string;
    model: string;
    year: number;
    bookingDailyRate: number | null;
    bookingInsuranceFee: number | null;
    bookingDepositAmount: number | null;
    bookingTaxName: string | null;
    bookingTaxRate: number | null;
    bookingWeeklyDiscountPercent: number | null;
    bookingMinimumRentalDays: number | null;
    bookingDailyKmAllowance: number | null;
    bookingExtraKmRate: number | null;
  };
  pickupDate: string;
  returnDate: string;
  pickupTime: string | null;
  returnTime: string | null;
  /** Per day as charged; null re-derives from the policy. */
  insuranceDailyRate: number | null;
  /** The code the renter used, so the schedule prices as checkout did. */
  coupon: CouponDiscount | null;
  /** Charged once, with the first period. */
  locationFeeAmount: number;
  chargedAmount: number | null;
}) {
  const existing = await prisma.orderPayment.count({ where: { orderId: input.order.id } });
  if (existing > 0) return;

  const policy = await getBookingPolicyForVehicle(input.vehicle);
  const rate = resolveVehicleDailyRate(input.vehicle, policy);
  const dailyRateOverrides = await loadPriceOverridesForBooking(input.vehicle.id);
  const seasonalRates =
    rate.source === "suggested"
      ? buildSeasonalRateMap(
          rate.dailyRate ?? 0,
          getBookingWindowDayKeys(),
          await getRateSeasonality(input.vehicle.workspaceId),
        )
      : {};
  const plan = getDirectBookingInstalmentPlan({
    pickupDate: input.pickupDate,
    returnDate: input.returnDate,
    weeklyDiscountPercent: policy.weeklyDiscountPercent,
    bookingDailyRate: rate.dailyRate ?? 0,
    dailyRateOverrides,
    seasonalRates,
    bookingInsuranceFee: input.insuranceDailyRate ?? policy.insuranceFee,
    bookingDepositAmount: policy.depositAmount,
    bookingTaxRate: policy.taxRate,
    taxLines: policy.taxLines,
    pickupTime: input.pickupTime,
    returnTime: input.returnTime,
    graceMinutes: policy.returnGraceMinutes,
    coupon: input.coupon,
    // Split across the two legs only so the quote adds them back up;
    // the plan puts the whole thing on period one either way.
    pickupLocationFee: input.locationFeeAmount,
    returnLocationFee: 0,
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

  // The trip's two moments: the renter's chosen times when the session
  // has them, midday as before when it predates them.
  // The insurance rate the renter was charged -- BC or non-BC licence --
  // for the contract and any instalments; absent on older sessions.
  const chargedInsuranceRate =
    metadata.insuranceDailyRate && Number.isFinite(Number(metadata.insuranceDailyRate))
      ? Number(metadata.insuranceDailyRate)
      : null;
  const usedCoupon: CouponDiscount | null =
    metadata.couponCode && isCouponKind(metadata.couponKind) && Number(metadata.couponValue) > 0
      ? { code: metadata.couponCode, kind: metadata.couponKind, value: Number(metadata.couponValue) }
      : null;
  const pickupTime = isBookingTime(metadata.pickupTime) ? metadata.pickupTime : null;
  const returnTime = isBookingTime(metadata.returnTime) ? metadata.returnTime : null;
  const pickupAt =
    (pickupTime && zonedDateTimeToUtc(pickupDate, pickupTime)) || dateOnlyToUtcMidday(pickupDate);
  const returnAt =
    (returnTime && zonedDateTimeToUtc(returnDate, returnTime)) || dateOnlyToUtcMidday(returnDate);

  if (hasTimedBookingConflict(vehicle.orders, pickupAt, returnAt)) {
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
      pickupDatetime: pickupAt,
      returnDatetime: returnAt,
      totalPrice,
      depositAmount: roundCurrencyAmount(
        depositAmount && !Number.isNaN(depositAmount) ? depositAmount : null,
      ),
      status: "booked",
      // Written onto the order so the handover has an address, not a
      // nickname the operator has to look up.
      pickupLocation: metadata.pickupLocation || null,
      returnLocation: metadata.returnLocation || null,
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
        hasLocalLicence:
          metadata.hasLocalLicence === "yes" ? true : metadata.hasLocalLicence === "no" ? false : null,
        insuranceDailyRate: chargedInsuranceRate,
        couponCode: usedCoupon?.code ?? null,
        couponAmount: metadata.couponAmount ? Number(metadata.couponAmount) : null,
        bookedDays: metadata.bookedDays ? Number(metadata.bookedDays) : null,
        taxName: metadata.taxName || null,
        taxRate: metadata.taxRate ? Number(metadata.taxRate) : null,
        taxAmount: metadata.taxAmount ? Number(metadata.taxAmount) : null,
        taxLines: readTaxLinesMetadata(metadata.taxLines),
        locationFeeAmount: metadata.locationFeeAmount
          ? Number(metadata.locationFeeAmount)
          : null,
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
      pickupTime,
      returnTime,
      insuranceDailyRate: chargedInsuranceRate,
      coupon: usedCoupon,
      locationFeeAmount: metadata.locationFeeAmount ? Number(metadata.locationFeeAmount) : 0,
      chargedAmount,
    });
  }

  // The code is spent the moment the booking it discounted is paid.
  if (usedCoupon) {
    await redeemCoupon({
      workspaceId: vehicle.workspaceId,
      code: usedCoupon.code,
      sessionId: session.id,
      orderId: order.id,
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
  // The fleet's insurance rate unless this car overrides it -- the same
  // resolution checkout priced the booking with.
  const vehiclePolicy = await getBookingPolicyForVehicle(vehicle);
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
          ? (chargedInsuranceRate ?? vehiclePolicy.insuranceFee) * Number(metadata.bookedDays)
          : null,
      insuranceDailyRate: (chargedInsuranceRate ?? vehiclePolicy.insuranceFee) || null,
      insuranceDays: metadata.bookedDays ? Number(metadata.bookedDays) : null,
      // The card itself stays with Stripe. What the contract records
      // is that one is on file, which is what its payment clause
      // actually needs -- storing the number would be a PCI matter and
      // storing the CVV is prohibited outright.
      paymentMethodOnFile: describeStripePaymentMethod(session),
      policy: vehiclePolicy,
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

function readTaxLinesMetadata(raw: string | undefined) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
