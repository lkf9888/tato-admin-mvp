/**
 * Coupon arithmetic, shared by the booking panel and checkout.
 *
 * A coupon comes off the rent only, after the weekly discount; tax is
 * then charged on what is left. Insurance, fees and the deposit are
 * never discounted.
 *
 * No `server-only`: the panel prices in the browser and must agree with
 * checkout to the cent.
 */

export type CouponKind = "percent" | "amount";

export type CouponDiscount = { code: string; kind: CouponKind; value: number };

export function isCouponKind(value: unknown): value is CouponKind {
  return value === "percent" || value === "amount";
}

/** Dollars off `rent`, never more than the rent itself. */
export function computeCouponAmount(rent: number, coupon: CouponDiscount | null | undefined) {
  if (!coupon || rent <= 0 || !(coupon.value > 0)) return 0;
  const raw = coupon.kind === "percent" ? rent * (Math.min(100, coupon.value) / 100) : coupon.value;
  return Math.round(Math.min(rent, raw) * 100) / 100;
}

/** Typed codes are forgiving about case and spaces. */
export function normalizeCouponCode(raw: string | null | undefined) {
  return (raw ?? "").trim().toUpperCase().replace(/\s+/g, "");
}
