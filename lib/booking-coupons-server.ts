import "server-only";

import { randomInt } from "crypto";

import {
  isCouponKind,
  normalizeCouponCode,
  type CouponDiscount,
  type CouponKind,
} from "@/lib/booking-coupons";
import { prisma } from "@/lib/prisma";

/** How long a checkout in progress holds a code before another renter may use it. */
export const COUPON_HOLD_MINUTES = 30;

// No 0/O, 1/I/L: a code read out over the phone should survive it.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function randomCode(prefix: string) {
  let body = "";
  for (let i = 0; i < 6; i += 1) body += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return `${prefix}-${body}`;
}

export type CouponState = "available" | "reserved" | "redeemed" | "expired" | "voided";

export function couponState(
  coupon: {
    redeemedAt: Date | null;
    voidedAt: Date | null;
    expiresAt: Date | null;
    reservedUntil: Date | null;
  },
  now = new Date(),
): CouponState {
  if (coupon.redeemedAt) return "redeemed";
  if (coupon.voidedAt) return "voided";
  if (coupon.expiresAt && coupon.expiresAt <= now) return "expired";
  if (coupon.reservedUntil && coupon.reservedUntil > now) return "reserved";
  return "available";
}

export async function createCoupon(input: {
  workspaceId: string;
  kind: CouponKind;
  value: number;
  expiresAt: Date | null;
  note: string | null;
  createdBy: string;
  prefix: string;
}) {
  // A clash with an existing code is vanishingly rare; try again rather
  // than fail the operator's click.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = randomCode(input.prefix);
    const exists = await prisma.bookingCoupon.findUnique({
      where: { workspaceId_code: { workspaceId: input.workspaceId, code } },
      select: { id: true },
    });
    if (exists) continue;
    return prisma.bookingCoupon.create({
      data: {
        workspaceId: input.workspaceId,
        code,
        kind: input.kind,
        value: input.value,
        expiresAt: input.expiresAt,
        note: input.note,
        createdBy: input.createdBy,
      },
    });
  }
  throw new Error("Could not generate a unique code.");
}

export type CouponCheck =
  | { ok: true; coupon: CouponDiscount & { id: string } }
  | { ok: false; reason: "not_found" | "redeemed" | "expired" | "voided" | "reserved" };

/** Whether a renter may use `rawCode` now, for a booking with this workspace. */
export async function checkCoupon(workspaceId: string, rawCode: string): Promise<CouponCheck> {
  const code = normalizeCouponCode(rawCode);
  if (!code) return { ok: false, reason: "not_found" };
  const coupon = await prisma.bookingCoupon.findUnique({
    where: { workspaceId_code: { workspaceId, code } },
  });
  if (!coupon || !isCouponKind(coupon.kind)) return { ok: false, reason: "not_found" };
  const state = couponState(coupon);
  if (state !== "available") return { ok: false, reason: state };
  return { ok: true, coupon: { id: coupon.id, code: coupon.code, kind: coupon.kind, value: coupon.value } };
}

/**
 * Hold a code for one checkout. Conditional in the write itself, so two
 * renters pressing Pay at the same moment cannot both get it.
 */
export async function reserveCoupon(couponId: string, sessionKey: string) {
  const now = new Date();
  const result = await prisma.bookingCoupon.updateMany({
    where: {
      id: couponId,
      redeemedAt: null,
      voidedAt: null,
      AND: [
        { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        { OR: [{ reservedUntil: null }, { reservedUntil: { lte: now } }] },
      ],
    },
    data: {
      reservedSessionId: sessionKey,
      reservedUntil: new Date(now.getTime() + COUPON_HOLD_MINUTES * 60_000),
    },
  });
  return result.count === 1;
}

/** Point a hold at the Stripe session it became, once that exists. */
export async function attachCouponToSession(couponId: string, sessionKey: string, sessionId: string) {
  await prisma.bookingCoupon.updateMany({
    where: { id: couponId, reservedSessionId: sessionKey },
    data: { reservedSessionId: sessionId },
  });
}

/** Let go of a hold whose checkout never got going. */
export async function releaseCoupon(couponId: string, sessionKey: string) {
  await prisma.bookingCoupon.updateMany({
    where: { id: couponId, reservedSessionId: sessionKey, redeemedAt: null },
    data: { reservedSessionId: null, reservedUntil: null },
  });
}

/**
 * The booking was paid: the code is spent. Matched by the session that
 * held it, and also accepted after its hold lapsed -- the renter paid,
 * so the discount they were charged stands either way.
 */
export async function redeemCoupon(input: {
  workspaceId: string;
  code: string;
  sessionId: string;
  orderId: string;
}) {
  const code = normalizeCouponCode(input.code);
  await prisma.bookingCoupon.updateMany({
    where: { workspaceId: input.workspaceId, code, redeemedAt: null },
    data: {
      redeemedAt: new Date(),
      redeemedOrderId: input.orderId,
      reservedSessionId: input.sessionId,
      reservedUntil: null,
    },
  });
}
