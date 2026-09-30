import "server-only";

import type Stripe from "stripe";

import { getBookingPolicyForVehicle } from "@/lib/booking-policy-server";
import { getChargedDays, utcToZonedDate, utcToZonedTime } from "@/lib/booking-time";
import { computeTaxes, getDirectBookingQuote, sumTaxes } from "@/lib/direct-booking";
import { sendExtraChargeEmail } from "@/lib/direct-booking-email";
import { logActivity } from "@/lib/orders";
import { syncOrderOwnerLedger } from "@/lib/owner-ledger";
import { prisma } from "@/lib/prisma";
import {
  buildSeasonalRateMap,
  getBookingWindowDayKeys,
  getRateSeasonality,
} from "@/lib/rental-estimate/rate-seasonality-server";
import { getAppUrl, getStripeClient, getStripeSecretKey } from "@/lib/stripe";
import { computePlatformFeeCents, getWorkspaceConnectSnapshot } from "@/lib/stripe-connect";
import { resolveVehicleDailyRate } from "@/lib/vehicle-pricing";
import { loadPriceOverridesForBooking } from "@/lib/vehicle-price-overrides";

/**
 * Charging for a trip that grew: a late return, an early pickup.
 *
 * The operator moves the order's times on the calendar as they always
 * have. What was paid for is a number of charged days (the booking's,
 * plus every extra charge since); what the order now spans is another.
 * The difference is billed at the car's own prices for those days,
 * with the booking's insurance rate, per-day extras and taxes -- the
 * same pieces checkout charged, never a new fee.
 *
 * Nothing is charged by moving a bar: the operator sees the amount and
 * confirms it. The saved card is charged when there is one (bookings
 * made from v1.15.0 keep it); otherwise, or when the bank wants the
 * renter to confirm, the renter is emailed a payment link.
 */

export type ExtraChargeRecord = {
  days: number;
  amount: number;
  status: "paid" | "pending";
  method: "card" | "link";
  paymentIntentId?: string | null;
  sessionId?: string | null;
  url?: string | null;
  paymentId?: string | null;
  at: string;
};

type OrderMetadata = {
  channel?: string;
  bookedDays?: number | null;
  insuranceDailyRate?: number | null;
  includeInsurance?: boolean;
  taxLines?: Array<{ name: string; rate: number }> | null;
  addOns?: Array<{ name: string; price: number; unit: string; taxable: boolean }> | null;
  renterEmail?: string | null;
  stripeCustomerId?: string | null;
  stripePaymentMethodId?: string | null;
  extraCharges?: ExtraChargeRecord[];
  [key: string]: unknown;
};

function readMetadata(raw: string | null): OrderMetadata {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as OrderMetadata) : {};
  } catch {
    return {};
  }
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

export type ExtraChargeQuote =
  | {
      ok: true;
      billedDays: number;
      currentDays: number;
      extraDays: number;
      lines: Array<{ label: string; amount: number }>;
      rent: number;
      /** What the 5% commission is taken on: rent, insurance, extras. */
      commissionBase: number;
      total: number;
      hasSavedCard: boolean;
      renterEmail: string | null;
      pending: ExtraChargeRecord[];
    }
  | { ok: false; reason: "NOT_FOUND" | "NOT_DIRECT_BOOKING" | "NO_BOOKED_DAYS" };

async function loadOrder(workspaceId: string, orderId: string) {
  return prisma.order.findFirst({
    where: { id: orderId, workspaceId, isArchived: false },
    include: { vehicle: true },
  });
}

export async function quoteExtraCharge(workspaceId: string, orderId: string): Promise<ExtraChargeQuote> {
  const order = await loadOrder(workspaceId, orderId);
  if (!order || !order.vehicle) return { ok: false, reason: "NOT_FOUND" };
  const metadata = readMetadata(order.sourceMetadata);
  if (metadata.channel !== "direct-booking") return { ok: false, reason: "NOT_DIRECT_BOOKING" };
  const bookedDays = Number(metadata.bookedDays);
  if (!Number.isFinite(bookedDays) || bookedDays < 1) return { ok: false, reason: "NO_BOOKED_DAYS" };

  const vehicle = order.vehicle;
  const policy = await getBookingPolicyForVehicle(vehicle);
  const extraCharges = metadata.extraCharges ?? [];
  // A link not yet paid still counts as billed, so the same days are
  // never asked for twice.
  const billedDays = bookedDays + extraCharges.reduce((sum, charge) => sum + charge.days, 0);

  const pickupDate = utcToZonedDate(order.pickupDatetime);
  const returnDate = utcToZonedDate(order.returnDatetime);
  const currentDays = getChargedDays({
    pickupDate,
    pickupTime: utcToZonedTime(order.pickupDatetime),
    returnDate,
    returnTime: utcToZonedTime(order.returnDatetime),
    graceMinutes: policy.returnGraceMinutes,
  });
  const extraDays = Math.max(0, currentDays - billedDays);

  const base = {
    ok: true as const,
    billedDays,
    currentDays,
    extraDays,
    hasSavedCard: Boolean(metadata.stripeCustomerId && metadata.stripePaymentMethodId),
    renterEmail: metadata.renterEmail ?? null,
    pending: extraCharges.filter((charge) => charge.status === "pending"),
  };
  if (extraDays === 0) {
    return { ...base, lines: [], rent: 0, commissionBase: 0, total: 0 };
  }

  // The car's own prices for the trip as it now stands; the added days
  // are priced as its last ones, at the rate (and weekly discount) the
  // whole trip now earns.
  const rate = resolveVehicleDailyRate(vehicle, policy);
  const dailyRate = rate.dailyRate ?? 0;
  const seasonalRates =
    rate.source === "suggested"
      ? buildSeasonalRateMap(dailyRate, getBookingWindowDayKeys(), await getRateSeasonality(vehicle.workspaceId))
      : {};
  const quote = getDirectBookingQuote({
    pickupDate,
    returnDate,
    pickupTime: utcToZonedTime(order.pickupDatetime),
    returnTime: utcToZonedTime(order.returnDatetime),
    graceMinutes: policy.returnGraceMinutes,
    bookingDailyRate: dailyRate,
    dailyRateOverrides: await loadPriceOverridesForBooking(vehicle.id),
    seasonalRates,
    weeklyDiscountPercent: policy.weeklyDiscountPercent,
  });
  const discountFactor = dailyRate > 0 ? quote.effectiveDailyRate / dailyRate : 1;
  const rent = roundMoney(
    quote.schedule.slice(-extraDays).reduce((sum, day) => sum + day.rate, 0) * discountFactor,
  );

  const insuranceRate =
    metadata.insuranceDailyRate != null
      ? Number(metadata.insuranceDailyRate)
      : metadata.includeInsurance
        ? policy.insuranceFee
        : 0;
  const insurance = roundMoney(Math.max(0, insuranceRate) * extraDays);
  const perDayAddOns = (metadata.addOns ?? []).filter((addOn) => addOn.unit === "day");
  const addOnLines = perDayAddOns.map((addOn) => ({
    label: `${addOn.name} × ${extraDays}`,
    amount: roundMoney(addOn.price * extraDays),
    taxable: addOn.taxable,
  }));
  const taxLines =
    metadata.taxLines && metadata.taxLines.length > 0
      ? metadata.taxLines.map((line) => ({ name: line.name, rate: line.rate }))
      : policy.taxLines;
  const taxableBase = roundMoney(
    rent + addOnLines.filter((line) => line.taxable).reduce((sum, line) => sum + line.amount, 0),
  );
  const taxes = computeTaxes(taxableBase, { taxLines });
  const addOnTotal = addOnLines.reduce((sum, line) => sum + line.amount, 0);

  // Rent and insurance as one line, as the booking showed them.
  const lines = [
    { label: `Rental, ${extraDays} extra day(s)`, amount: roundMoney(rent + insurance) },
    ...addOnLines.map(({ label, amount }) => ({ label, amount })),
    ...taxes
      .filter((tax) => tax.amount > 0)
      .map((tax) => ({ label: `${tax.name} (${Number(tax.rate.toFixed(3))}%)`, amount: tax.amount })),
  ];
  return {
    ...base,
    lines,
    rent,
    commissionBase: roundMoney(rent + insurance + addOnTotal),
    total: roundMoney(rent + insurance + addOnTotal + sumTaxes(taxes)),
  };
}

export type ExtraChargeResult =
  | { ok: true; outcome: "charged" | "link_sent"; amount: number; url?: string; emailed: boolean; fallbackReason?: string }
  | { ok: false; error: string };

/**
 * Bill the extra days: the saved card when asked and possible, a
 * payment link otherwise. `expectedTotal` is what the operator saw and
 * confirmed; if the numbers moved since, nothing is charged.
 */
export async function billExtraCharge(input: {
  workspaceId: string;
  orderId: string;
  method: "card" | "link";
  expectedTotal: number;
  actor: string;
}): Promise<ExtraChargeResult> {
  if (!getStripeSecretKey()) return { ok: false, error: "STRIPE_NOT_CONFIGURED" };
  const quote = await quoteExtraCharge(input.workspaceId, input.orderId);
  if (!quote.ok) return { ok: false, error: quote.reason };
  if (quote.extraDays === 0 || quote.total <= 0) return { ok: false, error: "NOTHING_TO_CHARGE" };
  if (Math.abs(quote.total - input.expectedTotal) > 0.009) return { ok: false, error: "AMOUNT_CHANGED" };

  const order = (await loadOrder(input.workspaceId, input.orderId))!;
  const vehicle = order.vehicle!;
  const metadata = readMetadata(order.sourceMetadata);
  const connect = await getWorkspaceConnectSnapshot(input.workspaceId);
  if (!connect.accountId || !connect.chargesEnabled) return { ok: false, error: "PAYOUTS_NOT_READY" };

  const stripe = getStripeClient();
  const amountCents = Math.round(quote.total * 100);
  const fee = computePlatformFeeCents({
    commissionBaseCents: Math.round(quote.commissionBase * 100),
    chargeTotalCents: amountCents,
  });
  const description = `${vehicle.nickname} · ${quote.extraDays} extra day(s)`;
  const chargeMetadata = {
    kind: "booking_extra_charge",
    orderId: order.id,
    workspaceId: input.workspaceId,
    extraDays: String(quote.extraDays),
    tato_platform_commission_cents: String(fee.commission),
    tato_stripe_fee_estimate_cents: String(fee.processing),
  };
  const destination = {
    on_behalf_of: connect.accountId,
    transfer_data: { destination: connect.accountId },
    application_fee_amount: fee.total > 0 ? fee.total : undefined,
  };
  // Keyed on what is being billed, so a double click or a retry cannot
  // charge the same days twice.
  const idempotencyBase = `extra:${order.id}:${quote.billedDays}:${quote.extraDays}:${amountCents}`;

  let fallbackReason: string | undefined;
  if (input.method === "card" && quote.hasSavedCard) {
    try {
      const intent = await stripe.paymentIntents.create(
        {
          amount: amountCents,
          currency: "cad",
          customer: metadata.stripeCustomerId!,
          payment_method: metadata.stripePaymentMethodId!,
          off_session: true,
          confirm: true,
          description,
          metadata: chargeMetadata,
          ...destination,
        },
        { idempotencyKey: `${idempotencyBase}:card` },
      );
      if (intent.status === "succeeded") {
        const payment = await prisma.orderPayment.create({
          data: {
            workspaceId: input.workspaceId,
            orderId: order.id,
            amount: quote.total,
            paidAt: new Date(),
            method: "Stripe",
            note: `Extra ${quote.extraDays} day(s) · card on file · ${intent.id}`,
            createdBy: input.actor,
          },
        });
        await recordCharge(order.id, {
          days: quote.extraDays,
          amount: quote.total,
          status: "paid",
          method: "card",
          paymentIntentId: intent.id,
          paymentId: payment.id,
          at: new Date().toISOString(),
        }, quote.total);
        const email = await sendExtraChargeEmail({
          workspaceId: input.workspaceId,
          order,
          vehicle,
          renterEmail: quote.renterEmail,
          extraDays: quote.extraDays,
          lines: quote.lines,
          total: quote.total,
          status: "charged",
        });
        await logActivity({
          workspaceId: input.workspaceId,
          actor: input.actor,
          action: "direct_booking_extra_charged",
          entityType: "Order",
          entityId: order.id,
          metadata: { amount: quote.total, extraDays: quote.extraDays, paymentIntentId: intent.id },
        });
        return { ok: true, outcome: "charged", amount: quote.total, emailed: email.ok };
      }
      fallbackReason = intent.status;
    } catch (error) {
      // Declined, or the bank wants the renter to confirm: a link is
      // how they can.
      const stripeError = error as { code?: string; message?: string } | null;
      fallbackReason = stripeError?.code ?? stripeError?.message ?? "card_failed";
    }
  } else if (input.method === "card") {
    fallbackReason = "no_saved_card";
  }

  // The payment link, on the operator's own site when there is one.
  const site = await prisma.rentalSite.findUnique({ where: { workspaceId: input.workspaceId } });
  const origin = site?.domain ? `https://${site.domain}` : getAppUrl().replace(/\/$/, "");
  const returnUrl = order.renterToken ? `${origin}/booking/${order.renterToken}` : origin;
  const session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      ...(metadata.stripeCustomerId
        ? { customer: metadata.stripeCustomerId }
        : quote.renterEmail
          ? { customer_email: quote.renterEmail }
          : {}),
      success_url: `${returnUrl}${returnUrl.includes("?") ? "&" : "?"}paid=extra`,
      cancel_url: returnUrl,
      line_items: quote.lines
        .filter((line) => line.amount > 0)
        .map((line) => ({
          quantity: 1,
          price_data: {
            currency: "cad",
            unit_amount: Math.round(line.amount * 100),
            product_data: { name: `${vehicle.nickname} — ${line.label}` },
          },
        })),
      payment_intent_data: { description, metadata: chargeMetadata, ...destination },
      metadata: chargeMetadata,
    },
    { idempotencyKey: `${idempotencyBase}:link` },
  );
  const payment = await prisma.orderPayment.create({
    data: {
      workspaceId: input.workspaceId,
      orderId: order.id,
      amount: quote.total,
      dueAt: new Date(),
      method: "Stripe",
      note: `Extra ${quote.extraDays} day(s) · payment link · ${session.id}`,
      createdBy: input.actor,
    },
  });
  await recordCharge(order.id, {
    days: quote.extraDays,
    amount: quote.total,
    status: "pending",
    method: "link",
    sessionId: session.id,
    url: session.url,
    paymentId: payment.id,
    at: new Date().toISOString(),
  }, 0);
  const email = await sendExtraChargeEmail({
    workspaceId: input.workspaceId,
    order,
    vehicle,
    renterEmail: quote.renterEmail,
    extraDays: quote.extraDays,
    lines: quote.lines,
    total: quote.total,
    status: "pay_link",
    payUrl: session.url,
  });
  await logActivity({
    workspaceId: input.workspaceId,
    actor: input.actor,
    action: "direct_booking_extra_link_sent",
    entityType: "Order",
    entityId: order.id,
    metadata: { amount: quote.total, extraDays: quote.extraDays, sessionId: session.id, fallbackReason },
  });
  return {
    ok: true,
    outcome: "link_sent",
    amount: quote.total,
    url: session.url ?? undefined,
    emailed: email.ok,
    fallbackReason,
  };
}

/** Append to the order's record; a paid charge also raises its value. */
async function recordCharge(orderId: string, charge: ExtraChargeRecord, paidAmount: number) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) return;
  const metadata = readMetadata(order.sourceMetadata);
  metadata.extraCharges = [...(metadata.extraCharges ?? []), charge];
  await prisma.order.update({
    where: { id: orderId },
    data: {
      sourceMetadata: JSON.stringify(metadata),
      ...(paidAmount > 0
        ? { totalPrice: roundMoney((order.totalPrice ?? 0) + paidAmount) }
        : {}),
    },
  });
  if (paidAmount > 0) await syncOrderOwnerLedger(orderId);
}

/**
 * The renter paid a link. Called from the Stripe webhook; safe to run
 * twice, because only a pending record is turned into a paid one.
 */
export async function completeExtraChargeFromSession(session: Stripe.Checkout.Session) {
  const orderId = session.metadata?.orderId;
  if (!orderId || session.payment_status !== "paid") return;
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { vehicle: true } });
  if (!order) return;
  const metadata = readMetadata(order.sourceMetadata);
  const charge = (metadata.extraCharges ?? []).find(
    (item) => item.sessionId === session.id && item.status === "pending",
  );
  if (!charge) return;

  charge.status = "paid";
  charge.paymentIntentId =
    typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null;
  await prisma.order.update({
    where: { id: orderId },
    data: {
      sourceMetadata: JSON.stringify(metadata),
      totalPrice: roundMoney((order.totalPrice ?? 0) + charge.amount),
    },
  });
  if (charge.paymentId) {
    await prisma.orderPayment.updateMany({
      where: { id: charge.paymentId, paidAt: null },
      data: { paidAt: new Date() },
    });
  }
  await syncOrderOwnerLedger(orderId);
  await logActivity({
    workspaceId: order.workspaceId ?? undefined,
    actor: "stripe-webhook",
    action: "direct_booking_extra_paid",
    entityType: "Order",
    entityId: orderId,
    metadata: { amount: charge.amount, sessionId: session.id },
  });
}
