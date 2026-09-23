/**
 * What a renter gets back when they cancel.
 *
 * The policy: free up to 48 hours before pickup, one day's rent kept
 * after that. The deposit is never part of the penalty -- it is the
 * renter's money held against damage to a car they never collected.
 *
 * Deliberately pure and free of `now`, which is passed in. A refund
 * figure that depends on an implicit clock cannot be tested against
 * the boundary it exists to enforce, and the boundary is the whole
 * policy.
 */

export const FREE_CANCELLATION_HOURS = 48;

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
  /** One day of rent, which is the late-cancellation penalty. */
  dailyRate: number;
  pickupDatetime: Date;
  now: Date;
}): CancellationQuote {
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

  if (hoursUntilPickup >= FREE_CANCELLATION_HOURS) {
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
  const penaltyAmount = roundMoney(Math.min(Math.max(0, input.dailyRate), rentPaid));
  return {
    outcome: "late",
    hoursUntilPickup,
    refundAmount: roundMoney(paid - penaltyAmount),
    penaltyAmount,
    isSelfServiceEligible: true,
  };
}
