import "server-only";

import type { Vehicle } from "@prisma/client";
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
  /** Absent on records from before v1.29.0, which were all extra days. */
  kind?: "days" | "reschedule" | "mileage";
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

export function readMetadata(raw: string | null): OrderMetadata {
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

export async function loadOrder(workspaceId: string, orderId: string) {
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

/** What a charge is for, as the bill email explains it. */
export type ChargeReason =
  | { kind: "days"; extraDays: number }
  | { kind: "reschedule" }
  | { kind: "mileage"; excessKm: number };

/**
 * Charge a direct booking an amount after the fact: the saved card when
 * asked and possible, a payment link by email otherwise (no card, a
 * decline, or the bank wanting the renter to confirm). Records the
 * payment on the order and emails the renter the bill.
 *
 * The one path for every later charge -- extra days, a dearer date
 * change, excess distance -- so they share the commission, the
 * idempotency and the receipt.
 */
export async function chargeOrder(input: {
  workspaceId: string;
  orderId: string;
  lines: Array<{ label: string; amount: number }>;
  total: number;
  /** What the 5% commission is taken on (the total less tax). */
  commissionBase: number;
  method: "card" | "link";
  actor: string;
  reason: ChargeReason;
  /** Keys the Stripe calls, so a double click cannot charge twice. */
  idempotencyBase: string;
}): Promise<ExtraChargeResult> {
  if (!getStripeSecretKey()) return { ok: false, error: "STRIPE_NOT_CONFIGURED" };
  if (input.total <= 0) return { ok: false, error: "NOTHING_TO_CHARGE" };
  const order = await loadOrder(input.workspaceId, input.orderId);
  if (!order?.vehicle) return { ok: false, error: "NOT_FOUND" };
  const vehicle = order.vehicle;
  const metadata = readMetadata(order.sourceMetadata);
  const renterEmail = metadata.renterEmail ?? null;
  const hasSavedCard = Boolean(metadata.stripeCustomerId && metadata.stripePaymentMethodId);
  const connect = await getWorkspaceConnectSnapshot(input.workspaceId);
  if (!connect.accountId || !connect.chargesEnabled) return { ok: false, error: "PAYOUTS_NOT_READY" };

  const stripe = getStripeClient();
  const total = roundMoney(input.total);
  const amountCents = Math.round(total * 100);
  const fee = computePlatformFeeCents({
    commissionBaseCents: Math.round(input.commissionBase * 100),
    chargeTotalCents: amountCents,
  });
  const describe =
    input.reason.kind === "days"
      ? `${input.reason.extraDays} extra day(s)`
      : input.reason.kind === "reschedule"
        ? "date change"
        : `${input.reason.excessKm} km over the allowance`;
  const description = `${vehicle.nickname} · ${describe}`;
  const days = input.reason.kind === "days" ? input.reason.extraDays : 0;
  const chargeMetadata = {
    kind: "booking_extra_charge",
    chargeKind: input.reason.kind,
    orderId: order.id,
    workspaceId: input.workspaceId,
    extraDays: String(days),
    tato_platform_commission_cents: String(fee.commission),
    tato_stripe_fee_estimate_cents: String(fee.processing),
  };
  const destination = {
    on_behalf_of: connect.accountId,
    transfer_data: { destination: connect.accountId },
    application_fee_amount: fee.total > 0 ? fee.total : undefined,
  };
  const emailBase = {
    workspaceId: input.workspaceId,
    order,
    vehicle,
    renterEmail,
    reason: input.reason,
    lines: input.lines,
    total,
  };

  let fallbackReason: string | undefined;
  if (input.method === "card" && hasSavedCard) {
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
        { idempotencyKey: `${input.idempotencyBase}:card` },
      );
      if (intent.status === "succeeded") {
        const payment = await prisma.orderPayment.create({
          data: {
            workspaceId: input.workspaceId,
            orderId: order.id,
            amount: total,
            paidAt: new Date(),
            method: "Stripe",
            note: `${describe} · card on file · ${intent.id}`,
            createdBy: input.actor,
          },
        });
        await recordCharge(
          order.id,
          {
            kind: input.reason.kind,
            days,
            amount: total,
            status: "paid",
            method: "card",
            paymentIntentId: intent.id,
            paymentId: payment.id,
            at: new Date().toISOString(),
          },
          total,
        );
        const email = await sendExtraChargeEmail({ ...emailBase, status: "charged" });
        await logActivity({
          workspaceId: input.workspaceId,
          actor: input.actor,
          action: "direct_booking_extra_charged",
          entityType: "Order",
          entityId: order.id,
          metadata: { kind: input.reason.kind, amount: total, paymentIntentId: intent.id },
        });
        return { ok: true, outcome: "charged", amount: total, emailed: email.ok };
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
        : renterEmail
          ? { customer_email: renterEmail }
          : {}),
      success_url: `${returnUrl}${returnUrl.includes("?") ? "&" : "?"}paid=extra`,
      cancel_url: returnUrl,
      line_items: input.lines
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
    { idempotencyKey: `${input.idempotencyBase}:link` },
  );
  const payment = await prisma.orderPayment.create({
    data: {
      workspaceId: input.workspaceId,
      orderId: order.id,
      amount: total,
      dueAt: new Date(),
      method: "Stripe",
      note: `${describe} · payment link · ${session.id}`,
      createdBy: input.actor,
    },
  });
  await recordCharge(
    order.id,
    {
      kind: input.reason.kind,
      days,
      amount: total,
      status: "pending",
      method: "link",
      sessionId: session.id,
      url: session.url,
      paymentId: payment.id,
      at: new Date().toISOString(),
    },
    0,
  );
  const email = await sendExtraChargeEmail({ ...emailBase, status: "pay_link", payUrl: session.url });
  await logActivity({
    workspaceId: input.workspaceId,
    actor: input.actor,
    action: "direct_booking_extra_link_sent",
    entityType: "Order",
    entityId: order.id,
    metadata: { kind: input.reason.kind, amount: total, sessionId: session.id, fallbackReason },
  });
  return {
    ok: true,
    outcome: "link_sent",
    amount: total,
    url: session.url ?? undefined,
    emailed: email.ok,
    fallbackReason,
  };
}

/**
 * Bill the extra days. `expectedTotal` is what the operator saw and
 * confirmed; if the numbers moved since, nothing is charged.
 */
export async function billExtraCharge(input: {
  workspaceId: string;
  orderId: string;
  method: "card" | "link";
  expectedTotal: number;
  actor: string;
}): Promise<ExtraChargeResult> {
  const quote = await quoteExtraCharge(input.workspaceId, input.orderId);
  if (!quote.ok) return { ok: false, error: quote.reason };
  if (quote.extraDays === 0 || quote.total <= 0) return { ok: false, error: "NOTHING_TO_CHARGE" };
  if (Math.abs(quote.total - input.expectedTotal) > 0.009) return { ok: false, error: "AMOUNT_CHANGED" };
  return chargeOrder({
    workspaceId: input.workspaceId,
    orderId: input.orderId,
    lines: quote.lines,
    total: quote.total,
    commissionBase: quote.commissionBase,
    method: input.method,
    actor: input.actor,
    reason: { kind: "days", extraDays: quote.extraDays },
    idempotencyBase: `extra:${input.orderId}:${quote.billedDays}:${quote.extraDays}:${Math.round(quote.total * 100)}`,
  });
}

/** Append to the order's record; a paid charge also raises its value. */
export async function recordCharge(orderId: string, charge: ExtraChargeRecord, paidAmount: number) {
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

/**
 * What a whole trip on this booking costs at today's prices: rent (with
 * the weekly rate it earns), the booking's insurance rate, its per-day
 * extras and the taxes on them. Deposit, collection fees and one-off
 * extras are left out -- moving the dates does not change them.
 *
 * Used to price a date change as the difference between two trips,
 * both at today's prices, so a price the operator changed since the
 * booking is never charged or refunded as if the renter had moved.
 */
export async function priceTrip(
  order: { sourceMetadata: string | null; vehicle: Vehicle },
  pickupAt: Date,
  returnAt: Date,
) {
  const metadata = readMetadata(order.sourceMetadata);
  const vehicle = order.vehicle;
  const policy = await getBookingPolicyForVehicle(vehicle);
  const rate = resolveVehicleDailyRate(vehicle, policy);
  const dailyRate = rate.dailyRate ?? 0;
  const seasonalRates =
    rate.source === "suggested"
      ? buildSeasonalRateMap(dailyRate, getBookingWindowDayKeys(), await getRateSeasonality(vehicle.workspaceId))
      : {};
  const insuranceRate =
    metadata.insuranceDailyRate != null
      ? Number(metadata.insuranceDailyRate)
      : metadata.includeInsurance
        ? policy.insuranceFee
        : 0;
  const perDayAddOns = (metadata.addOns ?? [])
    .filter((addOn) => addOn.unit === "day")
    .map((addOn, index) => ({
      id: String(index),
      name: addOn.name,
      description: null,
      price: addOn.price,
      unit: "day" as const,
      taxable: addOn.taxable,
    }));
  const taxLines =
    metadata.taxLines && metadata.taxLines.length > 0
      ? metadata.taxLines.map((line) => ({ name: line.name, rate: line.rate }))
      : policy.taxLines;
  const quote = getDirectBookingQuote({
    pickupDate: utcToZonedDate(pickupAt),
    returnDate: utcToZonedDate(returnAt),
    pickupTime: utcToZonedTime(pickupAt),
    returnTime: utcToZonedTime(returnAt),
    graceMinutes: policy.returnGraceMinutes,
    bookingDailyRate: dailyRate,
    dailyRateOverrides: await loadPriceOverridesForBooking(vehicle.id),
    seasonalRates,
    weeklyDiscountPercent: policy.weeklyDiscountPercent,
    bookingInsuranceFee: Math.max(0, insuranceRate),
    taxLines,
    addOns: perDayAddOns,
  });
  const beforeTax = roundMoney(quote.baseAmount + quote.insuranceAmount + quote.addOnAmount);
  return {
    days: quote.days,
    beforeTax,
    total: roundMoney(beforeTax + quote.taxAmount),
  };
}

/**
 * The days a booking has been paid (or billed) for: the booking's own,
 * plus extra days charged since. What the distance allowance is counted
 * against.
 */
export function paidDays(sourceMetadata: string | null): number | null {
  const metadata = readMetadata(sourceMetadata);
  const booked = Number(metadata.bookedDays);
  if (!Number.isFinite(booked) || booked < 1) return null;
  const extra = (metadata.extraCharges ?? [])
    .filter((charge) => (charge.kind ?? "days") === "days")
    .reduce((sum, charge) => sum + charge.days, 0);
  return booked + extra;
}
