// Deliberately not marked `server-only`, matching `lib/owner-ledger.ts`
// which imports this. That module is reachable from a client component
// through `lib/direct-booking.ts`, and the marker turns a tree-shaken
// import into a build error. The prisma-touching export below is only
// ever called from server code.
import { OwnerSettlementDirection } from "@prisma/client";

import { prisma } from "@/lib/prisma";

/**
 * Calendar-date key, in UTC. Both callers below need "is this rule's
 * start date on or before the date in question", not "did this many
 * milliseconds elapse" -- and comparing raw instants made a rule
 * effective "today" resolve as a future rule for roughly half of
 * every day.
 *
 * Rules are written at a fixed noon-UTC timestamp for the date they
 * name (see the order API's `cleaningFeeFrom` handling), specifically
 * so this comparison would not have to reason about time zones. But
 * `pickCommissionRule`/`resolveCleaningFee` were still comparing that
 * timestamp against the exact instant of "now": for any save made
 * before noon UTC on the effective date, or -- for anyone west of UTC
 * -- during their own evening, when the UTC calendar date has already
 * rolled to tomorrow, the rule just written compared as being in the
 * future and was skipped. The owner's page showed the terms as "starts
 * later" and the order panel showed the car's old cleaning fee, both
 * moments after saving the new ones.
 */
function dateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

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
  const onKey = dateKey(on);
  let best: T | null = null;
  for (const rule of rules) {
    if (dateKey(rule.effectiveFrom) > onKey) continue;
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
  const onKey = dateKey(on);
  let best: { id: string; amount: number; effectiveFrom: Date } | null = null;
  for (const rule of rules) {
    if (dateKey(rule.effectiveFrom) > onKey) continue;
    if (!best || rule.effectiveFrom.getTime() > best.effectiveFrom.getTime()) best = rule;
  }
  if (best) return { amount: best.amount, ruleId: best.id };
  return { amount: fallbackAmount ?? 0, ruleId: null };
}

/**
 * The two cleaning-fee numbers an order screen needs: the car's price
 * today, and the price this particular trip is actually charged.
 *
 * Pulled out because it was written once, correctly, inside the PATCH
 * response the order panel saves against -- and nowhere in whatever
 * first loads that panel. Opening an order read a plain object with no
 * `cleaningFee` on it at all, which rendered exactly like an empty
 * field: the amount was saved, the box was still blank, because the
 * page that loaded the order had never been asked for it.
 */
export function resolveOrderCleaningFees(order: {
  pickupDatetime: Date;
  vehicle: {
    cleaningFee: number | null;
    cleaningFeeRules: Array<{ id: string; amount: number; effectiveFrom: Date }>;
  };
}): { cleaningFee: number; cleaningFeeOnTrip: number } {
  return {
    cleaningFee: resolveCleaningFee(order.vehicle.cleaningFeeRules, new Date(), order.vehicle.cleaningFee)
      .amount,
    cleaningFeeOnTrip: resolveCleaningFee(
      order.vehicle.cleaningFeeRules,
      order.pickupDatetime,
      order.vehicle.cleaningFee,
    ).amount,
  };
}
