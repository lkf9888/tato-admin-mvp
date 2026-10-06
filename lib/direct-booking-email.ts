import "server-only";

import type { Order, Vehicle } from "@prisma/client";

import {
  DIRECT_BOOKING_EMAIL_VARIABLES,
  normalizeDirectBookingEmailTemplate,
  renderDirectBookingEmailSubject,
  renderDirectBookingEmailTemplate,
  type DirectBookingEmailValues,
} from "@/lib/direct-booking-email-template";
import { formatBookingMoment, isDateOnlyMoment, utcToZonedDate, utcToZonedTime } from "@/lib/booking-time";
import { getDirectBookingDays } from "@/lib/direct-booking";
import { formatSiteSender } from "@/lib/site-sender";
import { sendMail } from "@/lib/email";
import { getAppUrl } from "@/lib/stripe";
import { logActivity } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import { formatCurrency } from "@/lib/utils";

/** Short enough to read down a phone, long enough not to collide. */
function bookingReference(orderId: string) {
  return orderId.slice(-8).toUpperCase();
}

/** The operator's calendar day -- UTC would put an evening trip on the next one. */
function toDateOnly(value: Date) {
  return utcToZonedDate(value);
}

function formatDisplayDate(value: Date) {
  const iso = toDateOnly(value);
  return iso.replace(/-/g, "/");
}

/** Days as charged at checkout, which the webhook wrote on the order. */
function readBookedDays(sourceMetadata: string | null | undefined) {
  try {
    const days = Number(JSON.parse(sourceMetadata ?? "{}")?.bookedDays);
    return Number.isFinite(days) && days > 0 ? days : null;
  } catch {
    return null;
  }
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
  order: Pick<
    Order,
    | "id"
    | "renterName"
    | "pickupDatetime"
    | "returnDatetime"
    | "totalPrice"
    | "depositAmount"
    | "pickupLocation"
    | "returnLocation"
    | "sourceMetadata"
  >;
  vehicle: Pick<Vehicle, "nickname" | "brand" | "model" | "year" | "plateNumber">;
  brandName: string;
  contactPhone?: string | null;
  contactEmail?: string | null;
  /** Instalments, when the booking has any. */
  paidAmount?: number | null;
  balanceDue?: number | null;
  bookingUrl?: string | null;
}): DirectBookingEmailValues {
  const days =
    readBookedDays(input.order.sourceMetadata) ??
    getDirectBookingDays(
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
    pickupTime: isDateOnlyMoment(input.order.pickupDatetime) ? "" : utcToZonedTime(input.order.pickupDatetime),
    returnTime: isDateOnlyMoment(input.order.returnDatetime) ? "" : utcToZonedTime(input.order.returnDatetime),
    pickupLocation: input.order.pickupLocation?.trim() ?? "",
    returnLocation:
      input.order.returnLocation?.trim() &&
      input.order.returnLocation.trim() !== input.order.pickupLocation?.trim()
        ? input.order.returnLocation.trim()
        : "",
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
    | "id"
    | "renterName"
    | "pickupDatetime"
    | "returnDatetime"
    | "totalPrice"
    | "depositAmount"
    | "renterToken"
    | "pickupLocation"
    | "returnLocation"
    | "sourceMetadata"
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
    // Fixed, after the operator's own wording, so an edited template
    // cannot lose it: the check-in photos are the renter's protection
    // and the business's evidence.
    const bookingUrl = input.order.renterToken
      ? `${origin}/booking/${input.order.renterToken}`
      : null;
    const body = renderDirectBookingEmailTemplate(template.bodyTemplate, values);
    const checkIn = [
      "At pick-up: before you drive off, open your booking page and photograph the car —",
      "front, back, both sides, the interior and the dashboard (odometer and fuel).",
      "Do the same when you return it. These photos protect you from charges for",
      "damage that was already there. We will remind you an hour before pick-up.",
    ].join("\n");
    // Right under the booking link when the template has one, so it
    // reads as part of the letter rather than a postscript after the
    // sign-off; at the end, with the link, when it does not.
    const lines = body.split("\n");
    const linkLine = bookingUrl ? lines.findIndex((line) => line.includes(bookingUrl)) : -1;
    const text = !bookingUrl
      ? body
      : linkLine >= 0
        ? [...lines.slice(0, linkLine + 1), "", checkIn, ...lines.slice(linkLine + 1)].join("\n")
        : [body, "", checkIn, bookingUrl].join("\n");

    const result = await sendMail({
      to,
      subject,
      text,
      html: toHtmlBody(text),
      // A renter hitting Reply should reach the operator, not the
      // platform's envelope sender.
      replyTo: site?.contactEmail?.trim() || undefined,
      from: formatSiteSender(site),
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
      from: formatSiteSender(site),
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

/**
 * The bill for a trip that ran longer than was paid for -- a late
 * return, an early pickup. Either a receipt (the saved card was
 * charged) or a request with a payment link (no saved card, or the
 * bank asked the renter to confirm). Fixed wording, like the deposit
 * email: it is a statement of money, and every line of it is arithmetic.
 *
 * Never throws: when this runs the charge has already been made or the
 * link already exists.
 */
export async function sendExtraChargeEmail(input: {
  workspaceId: string;
  order: Pick<Order, "id" | "renterName" | "pickupDatetime" | "returnDatetime">;
  vehicle: Pick<Vehicle, "brand" | "model" | "year">;
  renterEmail: string | null;
  reason:
    | { kind: "days"; extraDays: number }
    | { kind: "reschedule" }
    | { kind: "mileage"; excessKm: number };
  lines: Array<{ label: string; amount: number }>;
  total: number;
  status: "charged" | "pay_link";
  payUrl?: string | null;
}): Promise<{ ok: boolean; reason?: string }> {
  try {
    const to = input.renterEmail?.trim();
    if (!to) return { ok: false, reason: "NO_RENTER_EMAIL" };

    const [site, workspace] = await Promise.all([
      prisma.rentalSite.findUnique({ where: { workspaceId: input.workspaceId } }),
      prisma.workspace.findUnique({ where: { id: input.workspaceId }, select: { name: true } }),
    ]);
    const brandName = site?.brandName?.trim() || workspace?.name?.trim() || "TATO";
    const money = (value: number) => formatCurrency(value, "en");
    const car = `${input.vehicle.year} ${input.vehicle.brand} ${input.vehicle.model}`;
    const when = (value: Date) => formatBookingMoment(value);

    const text = [
      `Hi ${input.order.renterName},`,
      "",
      input.reason.kind === "days"
        ? `Your trip in the ${car} now runs from ${when(input.order.pickupDatetime)} to ${when(input.order.returnDatetime)} (Vancouver time), ${input.reason.extraDays} day(s) longer than the booking you paid for.`
        : input.reason.kind === "reschedule"
          ? `Your trip in the ${car} has been moved to ${when(input.order.pickupDatetime)} – ${when(input.order.returnDatetime)} (Vancouver time). The new dates cost more than the booking you paid for; this is the difference.`
          : `Your trip in the ${car} went ${input.reason.excessKm} km over the distance included in your booking, charged at the excess-distance rate in your rental agreement.`,
      "",
      ...input.lines.map((line) => `${line.label}: ${money(line.amount)}`),
      `Total: ${money(input.total)}`,
      "",
      input.status === "charged"
        ? "This amount has been charged to the card you booked with, as the rental agreement provides."
        : `Please pay this amount here: ${input.payUrl ?? ""}`,
      "",
      `Booking reference: ${bookingReference(input.order.id)}`,
      site?.contactPhone || site?.contactEmail
        ? `Questions? ${[site?.contactPhone, site?.contactEmail].filter(Boolean).join(" · ")}`
        : null,
      "",
      brandName,
    ]
      .filter((line): line is string => line !== null)
      .join("\n");

    const result = await sendMail({
      to,
      subject:
        input.status === "charged"
          ? `${brandName} — receipt for your trip (${bookingReference(input.order.id)})`
          : `${brandName} — payment due for your trip (${bookingReference(input.order.id)})`,
      text,
      html: toHtmlBody(text),
      replyTo: site?.contactEmail?.trim() || undefined,
      from: formatSiteSender(site),
    });

    await logActivity({
      workspaceId: input.workspaceId,
      actor: "direct-booking",
      action: result.ok ? "extra_charge_email_sent" : "extra_charge_email_failed",
      entityType: "Order",
      entityId: input.order.id,
      metadata: { to, status: input.status, total: input.total, reason: result.reason ?? null },
    });
    return result;
  } catch (error) {
    await logActivity({
      workspaceId: input.workspaceId,
      actor: "direct-booking",
      action: "extra_charge_email_failed",
      entityType: "Order",
      entityId: input.order.id,
      metadata: { error: error instanceof Error ? error.message : String(error) },
    }).catch(() => undefined);
    return { ok: false, reason: "SEND_FAILED" };
  }
}

/**
 * Tell the operator a renter asked for something. Without it a request
 * sat in the admin until somebody happened to open the page. Sent to
 * the site's contact address (the mailbox renters write to) and to
 * every TATO account in the workspace (the addresses they signed up
 * with), each once. Bilingual, because the operator reads the admin in
 * either language. Never throws.
 */
/**
 * Who hears about a booking on the operator's side: the site's contact
 * address and every user of the workspace, each address once.
 */
async function loadOperatorRecipients(workspaceId: string) {
  const [site, workspace, users] = await Promise.all([
    prisma.rentalSite.findUnique({ where: { workspaceId } }),
    prisma.workspace.findUnique({ where: { id: workspaceId }, select: { name: true } }),
    prisma.user.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "asc" },
      select: { email: true },
    }),
  ]);
  const recipients = [
    ...new Map(
      [site?.contactEmail, ...users.map((user) => user.email)]
        .map((email) => email?.trim())
        .filter((email): email is string => Boolean(email))
        .map((email) => [email.toLowerCase(), email] as const),
    ).values(),
  ];
  return { site, brandName: site?.brandName?.trim() || workspace?.name?.trim() || "TATO", recipients };
}

/**
 * Tell the operator a booking came in on the site -- and, above all,
 * to block its dates on Turo. Turo cannot be written to (no API, no
 * calendar import), so until a person blocks them, the same car can be
 * booked twice for the same days.
 */
export async function sendNewBookingNotice(input: {
  workspaceId: string;
  order: Pick<Order, "id" | "renterName" | "renterPhone" | "pickupDatetime" | "returnDatetime" | "totalPrice">;
  vehicle: Pick<Vehicle, "plateNumber" | "brand" | "model" | "year" | "turoListingName">;
  renterEmail: string | null;
}): Promise<{ ok: boolean; reason?: string }> {
  try {
    const { site, brandName, recipients } = await loadOperatorRecipients(input.workspaceId);
    if (recipients.length === 0) return { ok: false, reason: "NO_OPERATOR_EMAIL" };
    const car = `${input.vehicle.plateNumber} · ${input.vehicle.year} ${input.vehicle.brand} ${input.vehicle.model}`;
    const trip = `${formatBookingMoment(input.order.pickupDatetime)} → ${formatBookingMoment(input.order.returnDatetime)}`;
    const text = [
      `网站新订单 / New booking on your site: ${input.order.renterName}`,
      "",
      `车辆 Car: ${car}`,
      `行程 Trip: ${trip}`,
      input.order.totalPrice != null ? `已付 Paid: ${formatCurrency(input.order.totalPrice, "en")}` : null,
      [input.order.renterPhone, input.renterEmail].filter(Boolean).length
        ? `租客 Renter: ${[input.order.renterPhone, input.renterEmail].filter(Boolean).join(" · ")}`
        : null,
      "",
      "⚠️ 请到 Turo 把这辆车的这几天挡掉，否则可能被重复预订。",
      "   Block these dates for this car on Turo, or it can be booked twice.",
      input.vehicle.turoListingName ? `   Turo 车辆 Listing: ${input.vehicle.turoListingName}` : null,
      `   ${trip}`,
      "",
      `订单 Order: ${getAppUrl().replace(/\/$/, "")}/orders/${input.order.id}`,
      `订单号 Reference: ${bookingReference(input.order.id)}`,
    ]
      .filter((line): line is string => line !== null)
      .join("\n");
    const subject = `[${brandName}] 新订单 New booking — ${input.vehicle.plateNumber}, ${formatBookingMoment(input.order.pickupDatetime)} · 记得挡 Turo / block Turo`;
    const results = await Promise.all(
      recipients.map((to) =>
        sendMail({ to, subject, text, html: toHtmlBody(text), from: formatSiteSender(site) }).then(
          (result) => ({ to, ...result }),
        ),
      ),
    );
    const ok = results.some((result) => result.ok);
    await logActivity({
      workspaceId: input.workspaceId,
      actor: "direct-booking",
      action: ok ? "new_booking_notice_sent" : "new_booking_notice_failed",
      entityType: "Order",
      entityId: input.order.id,
      metadata: {
        sent: results.filter((result) => result.ok).map((result) => result.to),
        failed: results.filter((result) => !result.ok).map((result) => ({ to: result.to, reason: result.reason ?? null })),
      },
    });
    return ok ? { ok: true } : { ok: false, reason: results[0]?.reason ?? "SEND_FAILED" };
  } catch (error) {
    await logActivity({
      workspaceId: input.workspaceId,
      actor: "direct-booking",
      action: "new_booking_notice_failed",
      entityType: "Order",
      entityId: input.order.id,
      metadata: { error: error instanceof Error ? error.message : String(error) },
    }).catch(() => undefined);
    return { ok: false, reason: "SEND_FAILED" };
  }
}

export async function sendChangeRequestNotice(input: {
  workspaceId: string;
  order: Pick<Order, "id" | "renterName" | "pickupDatetime" | "returnDatetime">;
  vehicle: Pick<Vehicle, "plateNumber" | "brand" | "model" | "year">;
  kind: "CANCEL" | "RESCHEDULE";
  requestedPickup: Date | null;
  requestedReturn: Date | null;
  quotedRefund: number | null;
  renterNote: string | null;
}): Promise<{ ok: boolean; reason?: string }> {
  try {
    const { site, brandName, recipients } = await loadOperatorRecipients(input.workspaceId);
    if (recipients.length === 0) return { ok: false, reason: "NO_OPERATOR_EMAIL" };
    const car = `${input.vehicle.plateNumber} · ${input.vehicle.year} ${input.vehicle.brand} ${input.vehicle.model}`;
    const trip = `${formatBookingMoment(input.order.pickupDatetime)} → ${formatBookingMoment(input.order.returnDatetime)}`;
    const isCancel = input.kind === "CANCEL";

    const text = [
      isCancel
        ? `${input.order.renterName} 申请取消订单 / asked to cancel their booking.`
        : `${input.order.renterName} 申请改期 / asked to move their booking.`,
      "",
      `车辆 Car: ${car}`,
      `原行程 Booked: ${trip}`,
      !isCancel && input.requestedPickup && input.requestedReturn
        ? `新行程 Requested: ${formatBookingMoment(input.requestedPickup)} → ${formatBookingMoment(input.requestedReturn)}`
        : null,
      isCancel && input.quotedRefund != null
        ? `按政策退款 Refund under policy: ${formatCurrency(input.quotedRefund, "en")}`
        : null,
      input.renterNote ? `租客留言 Note: ${input.renterNote}` : null,
      "",
      `批准或拒绝 Approve or decline: ${getAppUrl().replace(/\/$/, "")}/direct-booking/requests`,
      `订单 Reference: ${bookingReference(input.order.id)}`,
    ]
      .filter((line): line is string => line !== null)
      .join("\n");

    const subject = `[${brandName}] ${isCancel ? "取消申请 Cancellation request" : "改期申请 Change request"} — ${input.vehicle.plateNumber}, ${input.order.renterName}`;
    // One message per address, so no operator sees another's inbox in
    // the To line and one bad address cannot sink the rest.
    const results = await Promise.all(
      recipients.map((to) =>
        sendMail({ to, subject, text, html: toHtmlBody(text), from: formatSiteSender(site) }).then(
          (result) => ({ to, ...result }),
        ),
      ),
    );
    const ok = results.some((result) => result.ok);
    await logActivity({
      workspaceId: input.workspaceId,
      actor: "direct-booking",
      action: ok ? "change_request_notice_sent" : "change_request_notice_failed",
      entityType: "Order",
      entityId: input.order.id,
      metadata: {
        kind: input.kind,
        sent: results.filter((result) => result.ok).map((result) => result.to),
        failed: results
          .filter((result) => !result.ok)
          .map((result) => ({ to: result.to, reason: result.reason ?? null })),
      },
    });
    return ok ? { ok: true } : { ok: false, reason: results[0]?.reason ?? "SEND_FAILED" };
  } catch (error) {
    await logActivity({
      workspaceId: input.workspaceId,
      actor: "direct-booking",
      action: "change_request_notice_failed",
      entityType: "Order",
      entityId: input.order.id,
      metadata: { error: error instanceof Error ? error.message : String(error) },
    }).catch(() => undefined);
    return { ok: false, reason: "SEND_FAILED" };
  }
}

/**
 * Tell the renter what became of their booking: cancelled (with what
 * came back), moved, or a request declined. Without it the renter only
 * found out by reopening their booking page. Never throws.
 */
export async function sendBookingDecisionEmail(input: {
  workspaceId: string;
  order: Pick<Order, "id" | "renterName" | "pickupDatetime" | "returnDatetime" | "renterToken">;
  vehicle: Pick<Vehicle, "brand" | "model" | "year">;
  renterEmail: string | null;
  outcome: "cancelled" | "rescheduled" | "declined";
  refundAmount?: number;
  note?: string | null;
}): Promise<{ ok: boolean; reason?: string }> {
  try {
    const to = input.renterEmail?.trim();
    if (!to) return { ok: false, reason: "NO_RENTER_EMAIL" };
    const site = await prisma.rentalSite.findUnique({ where: { workspaceId: input.workspaceId } });
    const workspace = await prisma.workspace.findUnique({
      where: { id: input.workspaceId },
      select: { name: true },
    });
    const brandName = site?.brandName?.trim() || workspace?.name?.trim() || "TATO";
    const car = `${input.vehicle.year} ${input.vehicle.brand} ${input.vehicle.model}`;
    const origin = site?.domain ? `https://${site.domain}` : getAppUrl().replace(/\/$/, "");
    const trip = `${formatBookingMoment(input.order.pickupDatetime)} to ${formatBookingMoment(input.order.returnDatetime)}`;
    const refund = input.refundAmount ?? 0;

    const body =
      input.outcome === "cancelled"
        ? [
            `Your booking of the ${car} (${trip}) has been cancelled.`,
            refund > 0
              ? `${formatCurrency(refund, "en")} has been refunded to the card you paid with. Refunds usually appear on your statement within 5–10 business days.`
              : "No refund is due under the cancellation policy.",
          ]
        : input.outcome === "rescheduled"
          ? [
              `Your booking of the ${car} has been moved. It now runs from ${trip} (Vancouver time).`,
              refund > 0
                ? `The new dates cost less: ${formatCurrency(refund, "en")} has been refunded to the card you paid with. Refunds usually appear within 5–10 business days.`
                : null,
            ].filter((line): line is string => line !== null)
          : [`Your request for your booking of the ${car} (${trip}) could not be accepted. Your booking stays as it was.`];

    const text = [
      `Hi ${input.order.renterName},`,
      "",
      ...body,
      input.note ? `\nNote from ${brandName}: ${input.note}` : null,
      "",
      input.outcome !== "cancelled" && input.order.renterToken
        ? `Your booking: ${origin}/booking/${input.order.renterToken}`
        : null,
      `Booking reference: ${bookingReference(input.order.id)}`,
      site?.contactPhone || site?.contactEmail
        ? `Questions? ${[site?.contactPhone, site?.contactEmail].filter(Boolean).join(" · ")}`
        : null,
      "",
      brandName,
    ]
      .filter((line): line is string => line !== null)
      .join("\n");

    const subject =
      input.outcome === "cancelled"
        ? `${brandName} — booking cancelled (${bookingReference(input.order.id)})`
        : input.outcome === "rescheduled"
          ? `${brandName} — your booking has new dates (${bookingReference(input.order.id)})`
          : `${brandName} — about your change request (${bookingReference(input.order.id)})`;

    const result = await sendMail({
      to,
      subject,
      text,
      html: toHtmlBody(text),
      replyTo: site?.contactEmail?.trim() || undefined,
      from: formatSiteSender(site),
    });
    await logActivity({
      workspaceId: input.workspaceId,
      actor: "direct-booking",
      action: result.ok ? "booking_decision_email_sent" : "booking_decision_email_failed",
      entityType: "Order",
      entityId: input.order.id,
      metadata: { to, outcome: input.outcome, reason: result.reason ?? null },
    });
    return result;
  } catch (error) {
    await logActivity({
      workspaceId: input.workspaceId,
      actor: "direct-booking",
      action: "booking_decision_email_failed",
      entityType: "Order",
      entityId: input.order.id,
      metadata: { error: error instanceof Error ? error.message : String(error) },
    }).catch(() => undefined);
    return { ok: false, reason: "SEND_FAILED" };
  }
}

/**
 * An hour before pick-up: the renter is reminded to photograph the car
 * on their booking page, and every TATO account in the workspace to do
 * the same and note the odometer on the order. Never throws.
 */
export async function sendPickupReminderEmails(input: {
  workspaceId: string;
  order: Pick<Order, "id" | "renterName" | "pickupDatetime" | "returnDatetime" | "renterToken" | "pickupLocation">;
  vehicle: Pick<Vehicle, "brand" | "model" | "year" | "plateNumber">;
  renterEmail: string | null;
}): Promise<{ renter: boolean; operators: number }> {
  try {
    const [site, workspace, users] = await Promise.all([
      prisma.rentalSite.findUnique({ where: { workspaceId: input.workspaceId } }),
      prisma.workspace.findUnique({ where: { id: input.workspaceId }, select: { name: true } }),
      prisma.user.findMany({ where: { workspaceId: input.workspaceId }, select: { email: true } }),
    ]);
    const brandName = site?.brandName?.trim() || workspace?.name?.trim() || "TATO";
    const origin = site?.domain ? `https://${site.domain}` : getAppUrl().replace(/\/$/, "");
    const car = `${input.vehicle.year} ${input.vehicle.brand} ${input.vehicle.model}`;
    const when = formatBookingMoment(input.order.pickupDatetime);

    let renterSent = false;
    const renterTo = input.renterEmail?.trim();
    if (renterTo && input.order.renterToken) {
      const text = [
        `Hi ${input.order.renterName},`,
        "",
        `Your ${car} is ready for pick-up at ${when} (Vancouver time)${input.order.pickupLocation ? `, ${input.order.pickupLocation}` : ""}.`,
        "",
        "Before you drive off, open your booking page and photograph the car: front, back, both sides,",
        "the interior and the dashboard showing the odometer and fuel. It takes two minutes and protects you",
        "from being charged for damage that was already there.",
        `${origin}/booking/${input.order.renterToken}`,
        "",
        `Booking reference: ${bookingReference(input.order.id)}`,
        site?.contactPhone ? `Questions? ${site.contactPhone}` : null,
        "",
        brandName,
      ]
        .filter((line): line is string => line !== null)
        .join("\n");
      const result = await sendMail({
        to: renterTo,
        subject: `${brandName} — pick-up in an hour: please photograph the car`,
        text,
        html: toHtmlBody(text),
        replyTo: site?.contactEmail?.trim() || undefined,
        from: formatSiteSender(site),
      });
      renterSent = result.ok;
    }

    const operatorText = [
      `${input.order.renterName} 一小时后取车 / picks up in about an hour.`,
      "",
      `车辆 Car: ${input.vehicle.plateNumber} · ${car}`,
      `取车 Pick-up: ${when}${input.order.pickupLocation ? ` · ${input.order.pickupLocation}` : ""}`,
      "",
      "请拍取车照片并记录公里数和油量 / Photograph the car and record the odometer and fuel:",
      `${getAppUrl().replace(/\/$/, "")}/orders/${input.order.id}`,
    ].join("\n");
    const operatorEmails = [
      ...new Map(users.map((user) => [user.email.trim().toLowerCase(), user.email.trim()])).values(),
    ].filter(Boolean);
    const results = await Promise.all(
      operatorEmails.map((to) =>
        sendMail({
          to,
          subject: `[${brandName}] 取车提醒 Pick-up in 1 hour — ${input.vehicle.plateNumber}, ${input.order.renterName}`,
          text: operatorText,
          html: toHtmlBody(operatorText),
          from: formatSiteSender(site),
        }),
      ),
    );
    const operators = results.filter((result) => result.ok).length;

    await logActivity({
      workspaceId: input.workspaceId,
      actor: "direct-booking",
      action: "pickup_reminder_sent",
      entityType: "Order",
      entityId: input.order.id,
      metadata: { renter: renterSent, operators, operatorTotal: operatorEmails.length },
    });
    return { renter: renterSent, operators };
  } catch (error) {
    await logActivity({
      workspaceId: input.workspaceId,
      actor: "direct-booking",
      action: "pickup_reminder_failed",
      entityType: "Order",
      entityId: input.order.id,
      metadata: { error: error instanceof Error ? error.message : String(error) },
    }).catch(() => undefined);
    return { renter: false, operators: 0 };
  }
}

/**
 * An hour before return: the renter is reminded to photograph the car
 * as they hand it back, and the workspace to record the odometer and
 * check it over. Never throws.
 */
export async function sendReturnReminderEmails(input: {
  workspaceId: string;
  order: Pick<Order, "id" | "renterName" | "returnDatetime" | "renterToken" | "returnLocation" | "pickupLocation">;
  vehicle: Pick<Vehicle, "brand" | "model" | "year" | "plateNumber">;
  renterEmail: string | null;
}): Promise<{ renter: boolean; operators: number }> {
  try {
    const [site, workspace, users] = await Promise.all([
      prisma.rentalSite.findUnique({ where: { workspaceId: input.workspaceId } }),
      prisma.workspace.findUnique({ where: { id: input.workspaceId }, select: { name: true } }),
      prisma.user.findMany({ where: { workspaceId: input.workspaceId }, select: { email: true } }),
    ]);
    const brandName = site?.brandName?.trim() || workspace?.name?.trim() || "TATO";
    const origin = site?.domain ? `https://${site.domain}` : getAppUrl().replace(/\/$/, "");
    const car = `${input.vehicle.year} ${input.vehicle.brand} ${input.vehicle.model}`;
    const when = formatBookingMoment(input.order.returnDatetime);
    const place = input.order.returnLocation || input.order.pickupLocation;

    let renterSent = false;
    const renterTo = input.renterEmail?.trim();
    if (renterTo && input.order.renterToken) {
      const text = [
        `Hi ${input.order.renterName},`,
        "",
        `Your ${car} is due back at ${when} (Vancouver time)${place ? `, ${place}` : ""}.`,
        "",
        "When you return it, open your booking page and photograph the car again: front, back, both sides,",
        "the interior and the dashboard showing the odometer and fuel. These photos record the car's condition",
        "at hand-back and protect you from charges for anything that happens after.",
        `${origin}/booking/${input.order.renterToken}`,
        "",
        `Booking reference: ${bookingReference(input.order.id)}`,
        site?.contactPhone ? `Running late? Call ${site.contactPhone}.` : null,
        "",
        brandName,
      ]
        .filter((line): line is string => line !== null)
        .join("\n");
      const result = await sendMail({
        to: renterTo,
        subject: `${brandName} — return in an hour: please photograph the car`,
        text,
        html: toHtmlBody(text),
        replyTo: site?.contactEmail?.trim() || undefined,
        from: formatSiteSender(site),
      });
      renterSent = result.ok;
    }

    const operatorText = [
      `${input.order.renterName} 一小时后还车 / returns in about an hour.`,
      "",
      `车辆 Car: ${input.vehicle.plateNumber} · ${car}`,
      `还车 Return: ${when}${place ? ` · ${place}` : ""}`,
      "",
      "请拍还车照片、记录公里数和油量，检查车况 / Photograph the car, record the odometer and fuel, and check it over:",
      `${getAppUrl().replace(/\/$/, "")}/orders/${input.order.id}`,
    ].join("\n");
    const operatorEmails = [
      ...new Map(users.map((user) => [user.email.trim().toLowerCase(), user.email.trim()])).values(),
    ].filter(Boolean);
    const results = await Promise.all(
      operatorEmails.map((to) =>
        sendMail({
          to,
          subject: `[${brandName}] 还车提醒 Return in 1 hour — ${input.vehicle.plateNumber}, ${input.order.renterName}`,
          text: operatorText,
          html: toHtmlBody(operatorText),
          from: formatSiteSender(site),
        }),
      ),
    );
    const operators = results.filter((result) => result.ok).length;
    await logActivity({
      workspaceId: input.workspaceId,
      actor: "direct-booking",
      action: "return_reminder_sent",
      entityType: "Order",
      entityId: input.order.id,
      metadata: { renter: renterSent, operators },
    });
    return { renter: renterSent, operators };
  } catch (error) {
    await logActivity({
      workspaceId: input.workspaceId,
      actor: "direct-booking",
      action: "return_reminder_failed",
      entityType: "Order",
      entityId: input.order.id,
      metadata: { error: error instanceof Error ? error.message : String(error) },
    }).catch(() => undefined);
    return { renter: false, operators: 0 };
  }
}

/**
 * A week after the car came back with its deposit still held: remind
 * every TATO account in the workspace to settle it. Settling stays a
 * person's decision -- damage, tickets and tolls can surface late -- so
 * this asks, it does not refund. Never throws.
 */
export async function sendDepositReminderEmail(input: {
  workspaceId: string;
  order: Pick<Order, "id" | "renterName" | "returnDatetime" | "depositAmount">;
  vehicle: Pick<Vehicle, "plateNumber" | "brand" | "model" | "year">;
}): Promise<number> {
  try {
    const [site, workspace, users] = await Promise.all([
      prisma.rentalSite.findUnique({ where: { workspaceId: input.workspaceId } }),
      prisma.workspace.findUnique({ where: { id: input.workspaceId }, select: { name: true } }),
      prisma.user.findMany({ where: { workspaceId: input.workspaceId }, select: { email: true } }),
    ]);
    const brandName = site?.brandName?.trim() || workspace?.name?.trim() || "TATO";
    const deposit = formatCurrency(input.order.depositAmount ?? 0, "en");
    const text = [
      `${input.order.renterName} 的押金 ${deposit} 还没有退 / The ${deposit} deposit has not been settled yet.`,
      "",
      `车辆 Car: ${input.vehicle.plateNumber} · ${input.vehicle.year} ${input.vehicle.brand} ${input.vehicle.model}`,
      `还车 Returned: ${formatBookingMoment(input.order.returnDatetime)}（已超过一周 / over a week ago）`,
      "",
      "确认没有损伤、罚单或过路费后，在订单页退押金（可全退或扣留一部分并写明原因）/",
      "Once you are sure there is no damage, ticket or toll to come, settle it on the order (in full, or keep part with a reason):",
      `${getAppUrl().replace(/\/$/, "")}/orders/${input.order.id}`,
    ].join("\n");
    const emails = [
      ...new Map(users.map((user) => [user.email.trim().toLowerCase(), user.email.trim()])).values(),
    ].filter(Boolean);
    const results = await Promise.all(
      emails.map((to) =>
        sendMail({
          to,
          subject: `[${brandName}] 押金待退 Deposit to settle — ${input.vehicle.plateNumber}, ${input.order.renterName}`,
          text,
          html: toHtmlBody(text),
          from: formatSiteSender(site),
        }),
      ),
    );
    const sent = results.filter((result) => result.ok).length;
    await logActivity({
      workspaceId: input.workspaceId,
      actor: "direct-booking",
      action: "deposit_reminder_sent",
      entityType: "Order",
      entityId: input.order.id,
      metadata: { sent, total: emails.length },
    });
    return sent;
  } catch (error) {
    await logActivity({
      workspaceId: input.workspaceId,
      actor: "direct-booking",
      action: "deposit_reminder_failed",
      entityType: "Order",
      entityId: input.order.id,
      metadata: { error: error instanceof Error ? error.message : String(error) },
    }).catch(() => undefined);
    return 0;
  }
}

/**
 * A scheduled guest message (the operator's message rules, lib/message-rules.ts)
 * sent to a site renter as an email, in the site's own name. The rule's
 * text is the operator's, already filled in; this only frames it with the
 * booking link and reference so the renter can find their trip.
 */
export async function sendRuleMessageEmail(input: {
  workspaceId: string;
  order: Pick<Order, "id" | "renterToken">;
  renterEmail: string;
  text: string;
}): Promise<{ ok: boolean; error?: string }> {
  const [site, workspace] = await Promise.all([
    prisma.rentalSite.findUnique({ where: { workspaceId: input.workspaceId } }),
    prisma.workspace.findUnique({ where: { id: input.workspaceId }, select: { name: true } }),
  ]);
  const brandName = site?.brandName?.trim() || workspace?.name?.trim() || "TATO";
  const origin = site?.domain ? `https://${site.domain}` : getAppUrl().replace(/\/$/, "");
  const reference = bookingReference(input.order.id);
  const text = [
    input.text.trim(),
    "",
    "—",
    input.order.renterToken ? `Your booking: ${origin}/booking/${input.order.renterToken}` : null,
    `Booking reference: ${reference}`,
    brandName,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
  const result = await sendMail({
    to: input.renterEmail,
    subject: `${brandName} — about your booking ${reference}`,
    text,
    html: toHtmlBody(text),
    replyTo: site?.contactEmail?.trim() || undefined,
    from: formatSiteSender(site),
  });
  return result.ok ? { ok: true } : { ok: false, error: result.reason ?? "send_failed" };
}

export { DIRECT_BOOKING_EMAIL_VARIABLES };
