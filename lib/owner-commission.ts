// Deliberately not marked `server-only`, matching `lib/owner-ledger.ts`
// which imports this. That module is reachable from a client component
// through `lib/direct-booking.ts`, and the marker turns a tree-shaken
// import into a build error. The prisma-touching export below is only
// ever called from server code.
import { OwnerSettlementDirection } from "@prisma/client";

import { prisma } from "@/lib/prisma";

/**
 * What the management agreement said on a given day.
 *
 * A commission rate is a term of a contract, not a property of a row,
 * and contracts get renegotiated. Storing one number per owner means
 * raising the rate in March silently reprices every trip back to
 * January -- last quarter's statements stop reconciling against what
 * the owner was actually paid, and there is no record that the terms
 * ever changed.
 *
 * So the rate is a history keyed by start date, and a trip is priced
 * by whichever rule was in force on the day it started. Trips already
 * settled keep the terms they were settled under.
 *
 * `settlement` decides the direction, and it matters as much as the
 * percentage. When rent lands with the company we owe the owner their
 * share, so the statement is a payout. When it lands with the owner,
 * they are holding money that is partly ours, so the statement is an
 * invoice for the commission. Same rate, opposite sign.
 */
export type EffectiveCommission = {
  rate: number;
  settlement: OwnerSettlementDirection;
  /** Which rule supplied this, or null when it came from the fallback. */
  ruleId: string | null;
  effectiveFrom: Date | null;
};

/**
 * Pick the rule in force at `on` from an already-loaded list.
 *
 * Pure, so the ledger can resolve many orders against one query rather
 * than going back to the database per trip.
 *
 * Rules are expected newest-first. The first one whose start date has
 * arrived wins; if none has, the owner has rules but none that reach
 * back this far, and the caller falls back.
 */
export function pickCommissionRule<
  T extends { id: string; rate: number; settlement: OwnerSettlementDirection; effectiveFrom: Date },
>(rules: T[], on: Date): T | null {
  const at = on.getTime();
  let best: T | null = null;
  for (const rule of rules) {
    if (rule.effectiveFrom.getTime() > at) continue;
    if (!best || rule.effectiveFrom.getTime() > best.effectiveFrom.getTime()) best = rule;
  }
  return best;
}

/**
 * The terms to price one trip by.
 *
 * Falls back to the vehicle's own rate when the owner has no rule
 * covering the date, which is every owner until someone sets terms --
 * so adding this feature changes nobody's numbers until they use it.
 * The fallback has no direction of its own; it behaves as it always
 * did, with the money landing at the company.
 */
export function resolveCommission(
  rules: Array<{
    id: string;
    rate: number;
    settlement: OwnerSettlementDirection;
    effectiveFrom: Date;
  }>,
  on: Date,
  fallbackRate: number | null | undefined,
): EffectiveCommission {
  const rule = pickCommissionRule(rules, on);
  if (rule) {
    return {
      rate: rule.rate,
      settlement: rule.settlement,
      ruleId: rule.id,
      effectiveFrom: rule.effectiveFrom,
    };
  }

  return {
    rate: fallbackRate ?? 0,
    settlement: OwnerSettlementDirection.COMPANY_COLLECTS,
    ruleId: null,
    effectiveFrom: null,
  };
}

/** Every rule for one owner, newest start date first. */
export async function getOwnerCommissionRules(ownerId: string) {
  return prisma.ownerCommissionRule.findMany({
    where: { ownerId },
    orderBy: { effectiveFrom: "desc" },
  });
}

/**
 * The cleaning fee to charge for one trip.
 *
 * Same shape as the commission above, and for the same reason: the fee
 * is a price that gets revised, and a plain field on the vehicle would
 * reprice every trip that car ever ran the moment it changed.
 *
 * Anchored on the trip's start date rather than its return, so a trip
 * already under way keeps the fee it was booked under. "From this date
 * onward" reads as being about the trips that begin after it.
 */
export function resolveCleaningFee(
  rules: Array<{ id: string; amount: number; effectiveFrom: Date }>,
  on: Date,
  fallbackAmount: number | null | undefined,
): { amount: number; ruleId: string | null } {
  let best: { id: string; amount: number; effectiveFrom: Date } | null = null;
  const at = on.getTime();
  for (const rule of rules) {
    if (rule.effectiveFrom.getTime() > at) continue;
    if (!best || rule.effectiveFrom.getTime() > best.effectiveFrom.getTime()) best = rule;
  }
  if (best) return { amount: best.amount, ruleId: best.id };
  return { amount: fallbackAmount ?? 0, ruleId: null };
}
