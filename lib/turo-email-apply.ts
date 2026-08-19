import "server-only";

import { OrderStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { parseTuroOrderEmail, type TuroOrderFacts } from "@/lib/turo-email-order";
import { matchVehicles } from "@/lib/turo-message-match";

/**
 * Writing Turo's mail into orders.
 *
 * WHICH SOURCE WINS
 *
 * Established by running the parser over the whole archive and
 * comparing it against orders the CSV had imported independently: 132
 * of 136 reservations agreed on both datetimes. All four that did not
 * turned out to be the same thing, and it decides the policy here.
 *
 *   Reservation 60488863 — booking mail said the trip ran to Aug 22.
 *   The CSV said it ended Aug 18. Both are true: the guest reported
 *   damage, Turo restricted the vehicle, and the trip was cut short
 *   through the claims flow. Claims and support do not emit lifecycle
 *   mail, so the booking email still describes a plan that stopped
 *   being what happened.
 *
 * So: mail knows what was *scheduled*, and knows it sooner than any
 * export. The CSV knows what *happened*, and is the only thing that
 * does once a trip is over.
 *
 *   - Trip not yet finished  -> mail wins. It is fresher, and two of
 *     the four disagreements were the CSV being stale about a change
 *     confirmed after the export.
 *   - Trip completed         -> mail never moves a date. Its version
 *     is the plan; the CSV's is the outcome.
 *
 * Financials are never written from mail at all, on any status.
 * `You earn:` is quoted at booking, before tolls, late fees, cleaning,
 * damage or reimbursements move it, and the owner ledger is settled on
 * the CSV's figure. Filling `totalPrice` from an email would put an
 * estimate where the accounts expect a settlement.
 */

export type ApplyOutcome = {
  scanned: number;
  reservations: number;
  created: number;
  updated: number;
  /** Completed trips whose mail disagreed and was deliberately ignored. */
  skippedCompleted: number;
  /** Mail for a trip we have no order for, whose vehicle could not be
   *  pinned to exactly one car in the fleet. */
  ambiguousVehicle: {
    reservationId: string;
    vehicleText: string | null;
    matches: number;
    /** Null is the main account; a name means a co-hosted listing whose
     *  cars may simply not be in the fleet table yet. */
    turoAccount: string | null;
  }[];
  /** How many reservations each account contributed, so a co-hosted
   *  account that has stopped arriving is visible. */
  byAccount: Record<string, number>;
  unchanged: number;
};

/** Fold one reservation's mail, oldest first, so later state wins. */
function foldByReservation(
  emails: { subject: string; bodyText: string }[],
): Map<string, TuroOrderFacts> {
  const byReservation = new Map<string, TuroOrderFacts>();

  for (const email of emails) {
    const facts = parseTuroOrderEmail(email);
    if (!facts) continue;

    const existing = byReservation.get(facts.reservationId);
    if (!existing) {
      byReservation.set(facts.reservationId, facts);
      continue;
    }

    // Field by field, and only where the newer mail actually said
    // something: the trip-ended template names the reservation and
    // nothing else, and letting its blanks through would erase what
    // the booking mail correctly established.
    const merged: TuroOrderFacts = { ...existing };
    for (const key of Object.keys(facts) as (keyof TuroOrderFacts)[]) {
      const value = facts[key];
      if (value !== null && value !== undefined) {
        (merged as Record<string, unknown>)[key] = value;
      }
    }
    merged.intent = facts.intent;
    byReservation.set(facts.reservationId, merged);
  }

  return byReservation;
}

function statusFor(facts: TuroOrderFacts, current?: OrderStatus): OrderStatus {
  if (facts.intent === "cancelled") return OrderStatus.cancelled;
  if (facts.intent === "ended") return OrderStatus.completed;
  // A change or a booking says nothing about whether the trip has run.
  return current ?? OrderStatus.booked;
}

export async function applyTuroEmailsToOrders(input: {
  workspaceId: string;
  /** When false, nothing is written -- the counts describe what would
   *  have happened. */
  apply: boolean;
  actor?: string;
}): Promise<ApplyOutcome> {
  const emails = await prisma.inboundEmail.findMany({
    where: { workspaceId: input.workspaceId },
    orderBy: { receivedAt: "asc" },
    select: { subject: true, bodyText: true },
  });

  const folded = foldByReservation(emails);

  const outcome: ApplyOutcome = {
    scanned: emails.length,
    reservations: folded.size,
    created: 0,
    updated: 0,
    skippedCompleted: 0,
    ambiguousVehicle: [],
    byAccount: {},
    unchanged: 0,
  };

  if (folded.size === 0) return outcome;

  const [orders, fleet] = await Promise.all([
    prisma.order.findMany({
      where: {
        workspaceId: input.workspaceId,
        externalOrderId: { in: [...folded.keys()] },
      },
      select: {
        id: true,
        externalOrderId: true,
        status: true,
        renterPhone: true,
        pickupDatetime: true,
        returnDatetime: true,
      },
    }),
    prisma.vehicle.findMany({
      where: { workspaceId: input.workspaceId },
      select: {
        id: true,
        brand: true,
        model: true,
        year: true,
        nickname: true,
        turoListingName: true,
        turoAccount: true,
      },
    }),
  ]);

  const byExternalId = new Map(orders.map((order) => [order.externalOrderId ?? "", order]));

  for (const [reservationId, facts] of folded) {
    const accountKey = facts.coHostAccount ?? "(main)";
    outcome.byAccount[accountKey] = (outcome.byAccount[accountKey] ?? 0) + 1;

    const order = byExternalId.get(reservationId);

    if (!order) {
      // A trip the CSV has never carried -- often simply outside its
      // export window; the archive held one booked for January 2027.
      if (!facts.tripStart || !facts.tripEnd || !facts.vehicleText) {
        outcome.unchanged += 1;
        continue;
      }

      // Scoped to the account the mail came from. This fleet runs four
      // Tesla Model Y 2020s and two Ford Explorer 2014s across two
      // accounts, so the account is often the only thing that turns an
      // ambiguous model into one car.
      const matches = matchVehicles(facts.vehicleText, fleet, facts.coHostAccount);
      if (matches.length !== 1) {
        // Several cars of one model is normal here, and the mail names
        // no plate. Guessing would file a real booking against the
        // wrong vehicle, which shows up as a phantom conflict on the
        // calendar.
        outcome.ambiguousVehicle.push({
          reservationId,
          vehicleText: facts.vehicleText,
          matches: matches.length,
          turoAccount: facts.coHostAccount,
        });
        continue;
      }

      if (input.apply) {
        await prisma.order.create({
          data: {
            workspaceId: input.workspaceId,
            vehicleId: matches[0].id,
            externalOrderId: reservationId,
            renterName: facts.guestName ?? "Turo guest",
            renterPhone: facts.guestPhone,
            pickupDatetime: facts.tripStart,
            returnDatetime: facts.tripEnd,
            pickupLocation: facts.location,
            status: statusFor(facts),
            source: "turo",
            createdBy: input.actor ?? "turo-email",
            // Deliberately no totalPrice and no sourceMetadata. The
            // mail quotes an estimate; the ledger settles on the CSV.
          },
        });
      }
      outcome.created += 1;
      continue;
    }

    const finished =
      order.status === OrderStatus.completed || order.status === OrderStatus.cancelled;

    const data: {
      pickupDatetime?: Date;
      returnDatetime?: Date;
      renterPhone?: string;
      status?: OrderStatus;
    } = {};

    // A phone number is additive and safe on any status: the CSV does
    // not carry one, so this only ever fills a blank.
    if (!order.renterPhone && facts.guestPhone) data.renterPhone = facts.guestPhone;

    if (finished) {
      const wouldMove =
        (facts.tripStart && facts.tripStart.getTime() !== order.pickupDatetime.getTime()) ||
        (facts.tripEnd && facts.tripEnd.getTime() !== order.returnDatetime.getTime());
      if (wouldMove) outcome.skippedCompleted += 1;
    } else {
      if (facts.tripStart && facts.tripStart.getTime() !== order.pickupDatetime.getTime()) {
        data.pickupDatetime = facts.tripStart;
      }
      if (facts.tripEnd && facts.tripEnd.getTime() !== order.returnDatetime.getTime()) {
        data.returnDatetime = facts.tripEnd;
      }
      const nextStatus = statusFor(facts, order.status);
      if (nextStatus !== order.status) data.status = nextStatus;
    }

    if (Object.keys(data).length === 0) {
      outcome.unchanged += 1;
      continue;
    }

    if (input.apply) {
      await prisma.order.update({ where: { id: order.id }, data });
    }
    outcome.updated += 1;
  }

  return outcome;
}
