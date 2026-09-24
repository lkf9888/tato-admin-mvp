import "server-only";

import type { Order, Vehicle } from "@prisma/client";

import {
  DIRECT_BOOKING_EMAIL_VARIABLES,
  normalizeDirectBookingEmailTemplate,
  renderDirectBookingEmailSubject,
  renderDirectBookingEmailTemplate,
  type DirectBookingEmailValues,
} from "@/lib/direct-booking-email-template";
import { getDirectBookingDays } from "@/lib/direct-booking";
import { sendMail } from "@/lib/email";
import { getAppUrl } from "@/lib/stripe";
import { logActivity } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import { formatCurrency } from "@/lib/utils";

/** Short enough to read down a phone, long enough not to collide. */
function bookingReference(orderId: string) {
  return orderId.slice(-8).toUpperCase();
}

function toDateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function formatDisplayDate(value: Date) {
  const iso = toDateOnly(value);
  return iso.replace(/-/g, "/");
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The operator writes plain text; the renter's mail client gets HTML.
 *
 * Escaped first and then given line breaks, in that order -- reversed,
 * the `<br />` tags we just added would be escaped into visible markup.
 */
function toHtmlBody(text: string) {
  const body = escapeHtml(text).replace(/\n/g, "<br />");
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.65;color:#121214">${body}</div>`;
}

export function buildDirectBookingEmailValues(input: {
  order: Pick<Order, "id" | "renterName" | "pickupDatetime" | "returnDatetime" | "totalPrice" | "depositAmount">;
  vehicle: Pick<Vehicle, "nickname" | "brand" | "model" | "year" | "plateNumber">;
  brandName: string;
  contactPhone?: string | null;
  contactEmail?: string | null;
  /** Instalments, when the booking has any. */
  paidAmount?: number | null;
  balanceDue?: number | null;
  bookingUrl?: string | null;
}): DirectBookingEmailValues {
  const days = getDirectBookingDays(
    toDateOnly(input.order.pickupDatetime),
    toDateOnly(input.order.returnDatetime),
  );

  return {
    renterName: input.order.renterName,
    brandName: input.brandName,
    vehicleName: input.vehicle.nickname,
    vehicleDetail: `${input.vehicle.brand} ${input.vehicle.model} ${input.vehicle.year}`,
    plateNumber: input.vehicle.plateNumber,
    pickupDate: formatDisplayDate(input.order.pickupDatetime),
    returnDate: formatDisplayDate(input.order.returnDatetime),
    days: days > 0 ? String(days) : "",
    // Paid today, not the contract value: the default wording puts
    // this next to "Paid today", and a renter on an instalment plan
    // has handed over the first period only.
    totalAmount:
      input.paidAmount != null
        ? formatCurrency(input.paidAmount)
        : input.order.totalPrice != null
          ? formatCurrency(input.order.totalPrice)
          : "",
    // Both blank on a single payment, so their lines drop out.
    bookingTotal:
      input.balanceDue != null && input.balanceDue > 0 && input.order.totalPrice != null
        ? formatCurrency(input.order.totalPrice)
        : "",
    balanceDue:
      input.balanceDue != null && input.balanceDue > 0 ? formatCurrency(input.balanceDue) : "",
    depositAmount:
      input.order.depositAmount != null && input.order.depositAmount > 0
        ? formatCurrency(input.order.depositAmount)
        : "",
    contactPhone: input.contactPhone?.trim() ?? "",
    contactEmail: input.contactEmail?.trim() ?? "",
    bookingRef: bookingReference(input.order.id),
    bookingUrl: input.bookingUrl?.trim() ?? "",
  };
}

/**
 * Confirm a paid direct booking to the renter.
 *
 * Never throws. It is called from the Stripe webhook after the order
 * has been written and the host has been paid; a mail outage at that
 * moment is a missing email, not a reason to fail the webhook and have
 * Stripe retry an order we already created.
 */
export async function sendDirectBookingConfirmationEmail(input: {
  workspaceId: string;
  order: Pick<
    Order,
    "id" | "renterName" | "pickupDatetime" | "returnDatetime" | "totalPrice" | "depositAmount" | "renterToken"
  >;
  vehicle: Pick<Vehicle, "nickname" | "brand" | "model" | "year" | "plateNumber">;
  renterEmail: string | null;
}): Promise<{ ok: boolean; reason?: string }> {
  try {
    const to = input.renterEmail?.trim();
    if (!to) return { ok: false, reason: "NO_RENTER_EMAIL" };

    const [saved, site, workspace] = await Promise.all([
      prisma.directBookingEmailTemplate.findUnique({
        where: { workspaceId: input.workspaceId },
      }),
      prisma.rentalSite.findUnique({ where: { workspaceId: input.workspaceId } }),
      prisma.workspace.findUnique({
        where: { id: input.workspaceId },
        select: { name: true },
      }),
    ]);

    if (saved && !saved.isEnabled) {
      return { ok: false, reason: "DISABLED" };
    }

    // Read the schedule the webhook has already written, so the email
    // can tell a long-rental renter what left their card today and
    // what has not.
    const instalments = await prisma.orderPayment.findMany({
      where: { orderId: input.order.id },
      select: { amount: true, paidAt: true },
    });
    const paidAmount = instalments.length
      ? instalments.filter((row) => row.paidAt).reduce((sum, row) => sum + row.amount, 0)
      : null;
    const balanceDue = instalments.length
      ? instalments.filter((row) => !row.paidAt).reduce((sum, row) => sum + row.amount, 0)
      : null;

    const template = normalizeDirectBookingEmailTemplate(saved);
    // The renter's own page lives at the site's address when there is
    // one, so the link keeps them inside the brand they booked with.
    const origin = site?.domain
      ? `https://${site.domain}`
      : getAppUrl().replace(/\/$/, "");

    const values = buildDirectBookingEmailValues({
      paidAmount,
      balanceDue,
      bookingUrl: input.order.renterToken
        ? `${origin}/booking/${input.order.renterToken}`
        : null,
      order: input.order,
      vehicle: input.vehicle,
      // The renter booked on the operator's brand, not ours. Falling
      // back to the workspace name keeps TATO out of a customer's
      // inbox even when no site has been set up.
      brandName: site?.brandName?.trim() || workspace?.name?.trim() || "TATO",
      contactPhone: site?.contactPhone,
      contactEmail: site?.contactEmail,
    });

    const subject = renderDirectBookingEmailSubject(template.subjectTemplate, values);
    const text = renderDirectBookingEmailTemplate(template.bodyTemplate, values);

    const result = await sendMail({
      to,
      subject,
      text,
      html: toHtmlBody(text),
      // A renter hitting Reply should reach the operator, not the
      // platform's envelope sender.
      replyTo: site?.contactEmail?.trim() || undefined,
    });

    await logActivity({
      workspaceId: input.workspaceId,
      actor: "direct-booking",
      action: result.ok
        ? "direct_booking_confirmation_sent"
        : "direct_booking_confirmation_failed",
      entityType: "Order",
      entityId: input.order.id,
      metadata: { to, reason: result.reason ?? null },
    });

    return result;
  } catch (error) {
    await logActivity({
      workspaceId: input.workspaceId,
      actor: "direct-booking",
      action: "direct_booking_confirmation_failed",
      entityType: "Order",
      entityId: input.order.id,
      metadata: { error: error instanceof Error ? error.message : String(error) },
    }).catch(() => undefined);
    return { ok: false, reason: "SEND_FAILED" };
  }
}

/**
 * Tell the renter what happened to their deposit.
 *
 * Fixed wording rather than an operator template: it is a statement of
 * money, and the one line that matters -- how much came back and why
 * the rest did not -- is written by the operator per trip already.
 * Stripe's own refund receipt, when the account sends one, names an
 * amount and nothing else; a renter who sees $180 of a $300 deposit
 * return with no reason is a chargeback waiting to happen.
 *
 * Never throws, for the same reason the confirmation does not: the
 * money has already moved by the time this runs.
 */
export async function sendDepositSettlementEmail(input: {
  workspaceId: string;
  order: Pick<Order, "id" | "renterName" | "depositAmount">;
  vehicle: Pick<Vehicle, "brand" | "model" | "year">;
  renterEmail: string | null;
  refundedAmount: number;
  note: string | null;
}): Promise<{ ok: boolean; reason?: string }> {
  try {
    const to = input.renterEmail?.trim();
    if (!to) return { ok: false, reason: "NO_RENTER_EMAIL" };

    const [site, workspace] = await Promise.all([
      prisma.rentalSite.findUnique({ where: { workspaceId: input.workspaceId } }),
      prisma.workspace.findUnique({ where: { id: input.workspaceId }, select: { name: true } }),
    ]);
    const brandName = site?.brandName?.trim() || workspace?.name?.trim() || "TATO";
    const deposit = input.order.depositAmount ?? 0;
    const kept = Math.max(0, Math.round((deposit - input.refundedAmount) * 100) / 100);
    const money = (value: number) => formatCurrency(value, "en");
    const car = `${input.vehicle.year} ${input.vehicle.brand} ${input.vehicle.model}`;

    const lines = [
      `Hi ${input.order.renterName},`,
      "",
      kept === 0
        ? `Thanks for returning the ${car}. Your full security deposit of ${money(deposit)} has been refunded to the card you paid with.`
        : input.refundedAmount > 0
          ? `Thanks for returning the ${car}. ${money(input.refundedAmount)} of your ${money(deposit)} security deposit has been refunded to the card you paid with; ${money(kept)} has been kept.`
          : `Thanks for returning the ${car}. Your ${money(deposit)} security deposit has been kept.`,
      kept > 0 && input.note ? `\nReason: ${input.note}` : null,
      input.refundedAmount > 0
        ? "\nRefunds usually appear on your statement within 5–10 business days, depending on your bank."
        : null,
      "",
      `Booking reference: ${bookingReference(input.order.id)}`,
      site?.contactPhone || site?.contactEmail
        ? `Questions? ${[site?.contactPhone, site?.contactEmail].filter(Boolean).join(" · ")}`
        : null,
      "",
      brandName,
    ].filter((line): line is string => line !== null);
    const text = lines.join("\n");

    const result = await sendMail({
      to,
      subject: `${brandName} — your security deposit (${bookingReference(input.order.id)})`,
      text,
      html: toHtmlBody(text),
      replyTo: site?.contactEmail?.trim() || undefined,
    });

    await logActivity({
      workspaceId: input.workspaceId,
      actor: "direct-booking",
      action: result.ok ? "deposit_settlement_email_sent" : "deposit_settlement_email_failed",
      entityType: "Order",
      entityId: input.order.id,
      metadata: { to, reason: result.reason ?? null },
    });
    return result;
  } catch (error) {
    await logActivity({
      workspaceId: input.workspaceId,
      actor: "direct-booking",
      action: "deposit_settlement_email_failed",
      entityType: "Order",
      entityId: input.order.id,
      metadata: { error: error instanceof Error ? error.message : String(error) },
    }).catch(() => undefined);
    return { ok: false, reason: "SEND_FAILED" };
  }
}

export { DIRECT_BOOKING_EMAIL_VARIABLES };
