/**
 * What a renter gets back when they cancel.
 *
 * The operator picks one of four policies (fleet setting): free up to
 * a deadline before pick-up, and after it one day's rent, half the
 * rent, or all of it kept. The deposit is never part of the penalty --
 * it is the renter's money held against damage to a car they never
 * collected.
 *
 * Deliberately pure and free of `now`, which is passed in. A refund
 * figure that depends on an implicit clock cannot be tested against
 * the boundary it exists to enforce, and the boundary is the whole
 * policy.
 */

export const CANCELLATION_POLICY_KEYS = ["flexible", "moderate", "firm", "strict"] as const;
export type CancellationPolicyKey = (typeof CANCELLATION_POLICY_KEYS)[number];

/**
 * Named tiers rather than free numbers, so the booking page can state
 * the policy in one line a renter already understands, and the line,
 * the refund and the reschedule rule cannot drift apart. Wording lives
 * in `bookingMessages.cancellationPolicies`.
 */
export const CANCELLATION_POLICIES: Record<
  CancellationPolicyKey,
  { freeHours: number; lateKeeps: "oneDay" | "half" | "all" }
> = {
  flexible: { freeHours: 24, lateKeeps: "oneDay" },
  // What every booking ran under before the choice existed.
  moderate: { freeHours: 48, lateKeeps: "oneDay" },
  firm: { freeHours: 7 * 24, lateKeeps: "half" },
  strict: { freeHours: 14 * 24, lateKeeps: "all" },
};

export const DEFAULT_CANCELLATION_POLICY: CancellationPolicyKey = "moderate";

export function isCancellationPolicyKey(value: unknown): value is CancellationPolicyKey {
  return typeof value === "string" && (CANCELLATION_POLICY_KEYS as readonly string[]).includes(value);
}

/** Whether a change asked for now is past the policy's free deadline. */
export function isPastFreeCancellation(policy: CancellationPolicyKey, pickupAt: Date, now: Date) {
  return pickupAt.getTime() - now.getTime() < CANCELLATION_POLICIES[policy].freeHours * 3_600_000;
}

export type CancellationOutcome = "free" | "late" | "started";

export type CancellationQuote = {
  outcome: CancellationOutcome;
  /** Hours from `now` to pickup. Negative once the trip has started. */
  hoursUntilPickup: number;
  /** Money that would go back to the renter's card. */
  refundAmount: number;
  /** Rent kept by the operator. */
  penaltyAmount: number;
  /** True while the renter may still cancel themselves. */
  isSelfServiceEligible: boolean;
};

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

export function getCancellationQuote(input: {
  /** What the card was actually charged, deposit included. */
  paidAmount: number;
  /** The deposit portion of `paidAmount`. */
  depositAmount: number;
  /** One day of rent, the late penalty under the two gentler policies. */
  dailyRate: number;
  pickupDatetime: Date;
  now: Date;
  policy?: CancellationPolicyKey;
}): CancellationQuote {
  const policy = CANCELLATION_POLICIES[input.policy ?? DEFAULT_CANCELLATION_POLICY];
  const paid = Math.max(0, input.paidAmount);
  const deposit = Math.min(Math.max(0, input.depositAmount), paid);
  const rentPaid = roundMoney(paid - deposit);
  const hoursUntilPickup =
    (input.pickupDatetime.getTime() - input.now.getTime()) / 3_600_000;

  // A trip that has started is not a cancellation, it is an early
  // return -- which the agreement charges in full. Nothing is refunded
  // automatically; the operator can still decide otherwise.
  if (hoursUntilPickup <= 0) {
    return {
      outcome: "started",
      hoursUntilPickup,
      refundAmount: 0,
      penaltyAmount: rentPaid,
      isSelfServiceEligible: false,
    };
  }

  if (hoursUntilPickup >= policy.freeHours) {
    return {
      outcome: "free",
      hoursUntilPickup,
      refundAmount: roundMoney(paid),
      penaltyAmount: 0,
      isSelfServiceEligible: true,
    };
  }

  // Never more than the rent actually paid: a booking whose first
  // period was cheaper than a day's rate cannot owe more than it took.
  const kept =
    policy.lateKeeps === "all" ? rentPaid : policy.lateKeeps === "half" ? rentPaid / 2 : Math.max(0, input.dailyRate);
  const penaltyAmount = roundMoney(Math.min(kept, rentPaid));
  return {
    outcome: "late",
    hoursUntilPickup,
    refundAmount: roundMoney(paid - penaltyAmount),
    penaltyAmount,
    isSelfServiceEligible: true,
  };
}
