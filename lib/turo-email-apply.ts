import "server-only";

import { OrderStatus, VehicleStatus } from "@prisma/client";

import { reconcileVehicleConflicts } from "@/lib/orders";
import { syncOrderOwnerLedger } from "@/lib/owner-ledger";
import { prisma } from "@/lib/prisma";
import { parseTuroOrderEmail, type TuroOrderFacts } from "@/lib/turo-email-order";
import { matchVehiclesForEmail, placeBooking } from "@/lib/turo-message-match";
import { foldLatinLookalikes } from "@/lib/utils";

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
 *
 * THREE SOURCES, ONE ORDER
 *
 * Mail, the CSV export and the agent's trip-page reads all describe the
 * same reservation, keyed on its id. Who decides what:
 *
 *   field              CSV             mail / page read
 *   car                yes (plate)     only when placing a new trip
 *   dates, status      finished trips  unfinished trips, newest wins
 *   amounts, fees      yes             never
 *   phone              if present      fills a blank
 *
 * Mail and page reads are folded together by time (`foldFacts`) and are
 * stored, so every sync re-derives the same answer. A CSV import writes
 * the export as it stands and then re-applies that fold to the trips it
 * just wrote (`reapplyTuroObservations`), so an unfinished trip never
 * shows the export's older dates between syncs. Every order this file
 * moves or creates is re-run through `syncOrderOwnerLedger`, because the
 * ledger is written from status and dates, not only from amounts.
 */

export type ApplyOutcome = {
  scanned: number;
  reservations: number;
  created: number;
  updated: number;
  /** Completed trips whose mail disagreed and was deliberately ignored. */
  skippedCompleted: number;
  /** Bookings parked in the unassigned basket this run. */
  pending: number;
  /** Trips cancelled before they could be placed on a car: neither
   *  created nor parked, and cleared from the basket if they were in it. */
  cancelledUnplaced: number;
  /** Overrides that named a plate no vehicle in this workspace has.
   *  Reported rather than ignored: a typo here files nothing, and
   *  silence would look identical to the trip not existing. */
  unknownPlates: { reservationId: string; plate: string }[];
  /** Plates the agent read off a trip page that match no car here --
   *  a placeholder plate, a co-host's car not imported yet. Unlike an
   *  operator's override these do not drop the booking: it is parked in
   *  the unassigned basket, and never matched by model instead, because
   *  the page has just said which car it is and that car is not one of
   *  ours. */
  unresolvedPlateHints: { reservationId: string; plate: string }[];
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
  /** Bookings placed on a car only because a deactivated (停用) twin
   *  was ruled out. Listed, not just counted: this is the one way a
   *  deactivation changes where trips land, so a dry run should show
   *  exactly which ones it would move. */
  placedPastDeactivated: { reservationId: string; vehicleId: string }[];
  /** How many reservations each account contributed, so a co-hosted
   *  account that has stopped arriving is visible. */
  byAccount: Record<string, number>;
  /** Vehicles whose conflict flags were recomputed because this run
   *  moved or added one of their bookings. */
  conflictsRechecked: number;
  /** Agent reads whose times were the known trip's local wall clock
   *  labelled as UTC -- a page's "10:00 AM" sent as 10:00Z. Refused and
   *  listed: stored, they would be the newest observation and move the
   *  trip by seven or eight hours on every sync after. */
  suspectedTimezoneShift: { reservationId: string }[];
  unchanged: number;
};

/** Fold one reservation's mail, oldest first, so later state wins. */
/** One observation of a reservation, from mail or from the trip page. */
type FactsEvent = { at: Date; facts: TuroOrderFacts };

/**
 * Fold observations into one set of facts per reservation, oldest first.
 *
 * Mail and trip-page snapshots are folded together, by the time each was
 * observed. "Mail wins on an unfinished trip" (above) was always a claim
 * about freshness -- mail knows sooner than a CSV export -- and a trip
 * page read after the last email is fresher still. So whichever was seen
 * later wins, and a later email (a cancellation) still beats an earlier
 * look at the page. Ties go to the snapshot: callers pass mail events
 * first, and the sort is stable, so at the same instant the page read --
 * which reflects the mail already sent -- is applied last.
 */
function foldFacts(events: FactsEvent[]): Map<string, TuroOrderFacts> {
  const ordered = [...events].sort((a, b) => a.at.getTime() - b.at.getTime());
  const byReservation = new Map<string, TuroOrderFacts>();

  for (const { facts } of ordered) {
    const existing = byReservation.get(facts.reservationId);
    if (!existing) {
      byReservation.set(facts.reservationId, facts);
      continue;
    }

    // Field by field, and only where the newer observation actually
    // said something: the trip-ended template names the reservation and
    // nothing else, and letting its blanks through would erase what the
    // booking mail correctly established.
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

function mailEvents(emails: { subject: string; bodyText: string; receivedAt: Date }[]): FactsEvent[] {
  const events: FactsEvent[] = [];
  for (const email of emails) {
    const facts = parseTuroOrderEmail(email);
    if (facts) events.push({ at: email.receivedAt, facts });
  }
  return events;
}

type StoredSnapshot = {
  reservationId: string;
  observedAt: Date;
  facts: string;
  plate: string | null;
};

/** Stored snapshot facts, with dates revived. Unreadable rows are skipped
 *  rather than allowed to stop the sync that every other booking needs. */
function readSnapshotFacts(snapshot: StoredSnapshot): TuroOrderFacts | null {
  try {
    const raw = JSON.parse(snapshot.facts) as Record<string, unknown>;
    return {
      ...(raw as unknown as TuroOrderFacts),
      reservationId: snapshot.reservationId,
      tripStart: typeof raw.tripStart === "string" ? new Date(raw.tripStart) : null,
      tripEnd: typeof raw.tripEnd === "string" ? new Date(raw.tripEnd) : null,
    };
  } catch {
    return null;
  }
}

function snapshotEvents(snapshots: StoredSnapshot[]): FactsEvent[] {
  return snapshots.flatMap((snapshot) => {
    const facts = readSnapshotFacts(snapshot);
    return facts ? [{ at: snapshot.observedAt, facts }] : [];
  });
}

function snapshotPlates(snapshots: StoredSnapshot[]): Record<string, string> {
  const plates: Record<string, string> = {};
  for (const snapshot of snapshots) {
    if (snapshot.plate?.trim()) plates[snapshot.reservationId] = snapshot.plate.trim();
  }
  return plates;
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
  /** Reservation id -> plate, for trips the mail cannot resolve on its
   *  own.
   *
   *  Turo names the model and never the plate, so a fleet running two
   *  Ford Explorer 2014s has no way to tell which one a trip is on.
   *  There is no signal in the email to reason from, so this is a
   *  person answering the question rather than the code guessing at
   *  it -- and it needs answering only once, because from then on the
   *  order matches on its reservation id like any other. */
  plateOverrides?: Record<string, string>;
}): Promise<ApplyOutcome> {
  const { facts, plateHints, emailCount } = await loadObservations(input.workspaceId);
  const outcome = await applyTuroOrderFacts({
    workspaceId: input.workspaceId,
    facts,
    apply: input.apply,
    actor: input.actor,
    plateOverrides: input.plateOverrides,
    plateHints,
  });
  return { ...outcome, scanned: emailCount };
}

/** Every mail and trip-page observation in the workspace, folded. */
async function loadObservations(workspaceId: string) {
  const [emails, snapshots] = await Promise.all([
    prisma.inboundEmail.findMany({
      where: { workspaceId },
      orderBy: { receivedAt: "asc" },
      select: { subject: true, bodyText: true, receivedAt: true },
    }),
    prisma.turoTripSnapshot.findMany({
      where: { workspaceId },
      select: { reservationId: true, observedAt: true, facts: true, plate: true },
    }),
  ]);
  return {
    facts: foldFacts([...mailEvents(emails), ...snapshotEvents(snapshots)]),
    plateHints: snapshotPlates(snapshots),
    emailCount: emails.length,
  };
}

/**
 * Re-derive these reservations from mail and trip-page reads, right
 * after a CSV import has written them.
 *
 * The CSV writes every row's dates and status as the export states
 * them. On an unfinished trip the export can be older than the last
 * email or page read -- that is why mail wins there -- but the sync that
 * enforces it only runs every few minutes. Until it did, the calendar
 * showed the export's dates, conflicts were computed on them, and the
 * next sync moved them back: one trip, two answers, depending on when
 * you looked. Running the same fold for the imported reservations
 * straight away gives the answer the next sync would, with no window.
 *
 * Finished trips are untouched by the fold, so on them the CSV stands.
 */
export async function reapplyTuroObservations(input: {
  workspaceId: string;
  reservationIds: string[];
  actor?: string;
}): Promise<ApplyOutcome> {
  const wanted = new Set(input.reservationIds.map((id) => id.trim()).filter(Boolean));
  const { facts, plateHints } = await loadObservations(input.workspaceId);
  const outcome = await applyTuroOrderFacts({
    workspaceId: input.workspaceId,
    facts: new Map([...facts].filter(([id]) => wanted.has(id))),
    apply: true,
    actor: input.actor ?? "turo-email",
    plateHints,
  });
  return { ...outcome, scanned: wanted.size };
}

/**
 * Write folded facts into orders: place new bookings, park the ones that
 * cannot be placed, move dates on unfinished trips, and recompute
 * conflicts on every car touched.
 *
 * Takes facts rather than mail so that any source can feed it. Callers
 * that are a new *source* -- the agent -- should go through
 * `ingestTuroTripSnapshots`, which records the observation first; facts
 * handed straight to this function are forgotten, and the next mail sync
 * will re-derive the trip without them.
 */
export async function applyTuroOrderFacts(input: {
  workspaceId: string;
  facts: Map<string, TuroOrderFacts>;
  /** When false, nothing is written. */
  apply: boolean;
  actor?: string;
  /** An operator's plate: wins outright, and one that matches no car
   *  drops the booking and is reported, since it is a typo. */
  plateOverrides?: Record<string, string>;
  /** A plate read off Turo's own trip page: wins when it matches a car
   *  (a deactivated one included -- this is evidence, not a model
   *  guess), and parks the booking when it matches none. */
  plateHints?: Record<string, string>;
}): Promise<ApplyOutcome> {
  const folded = input.facts;

  const outcome: ApplyOutcome = {
    scanned: folded.size,
    reservations: folded.size,
    created: 0,
    updated: 0,
    skippedCompleted: 0,
    pending: 0,
    cancelledUnplaced: 0,
    ambiguousVehicle: [],
    unknownPlates: [],
    unresolvedPlateHints: [],
    placedPastDeactivated: [],
    byAccount: {},
    conflictsRechecked: 0,
    suspectedTimezoneShift: [],
    unchanged: 0,
  };

  if (folded.size === 0) return outcome;

  // Vehicles whose bookings this run moved or added. `hasConflict` is a
  // stored flag, recomputed per vehicle rather than derived on read, so
  // a date this pass changes is invisible to the conflict detector
  // until someone recomputes it. Writing an order without that step
  // means the calendar can hold a real double-booking that nothing
  // reports -- the exact failure the detector exists to prevent.
  const touchedVehicles = new Set<string>();
  // Orders this run created or moved. The owner ledger is written from
  // an order's status and dates -- a cancelled trip carries no lines, a
  // line is dated at pickup, commission terms are the ones in force that
  // day -- so an order changed here without a resync keeps crediting the
  // owner for a trip Turo has cancelled until the next CSV import.
  const ledgerOrders = new Set<string>();

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
      // Archived cars are excluded, or booking mail would keep filing
      // new trips against a car retired precisely to stop receiving them.
      where: { workspaceId: input.workspaceId, isArchived: false },
      select: {
        id: true,
        brand: true,
        model: true,
        year: true,
        nickname: true,
        turoListingName: true,
        turoAccount: true,
        plateNumber: true,
        status: true,
      },
    }),
  ]);

  // Deactivated cars stay in the fleet -- a plate typed by an operator
  // still resolves to one -- but are never chosen from a model match.
  // Each one's latest booking decides which trips it can be ruled out
  // for; see `placeBooking`.
  const deactivatedIds = new Set(
    fleet.filter((vehicle) => vehicle.status === VehicleStatus.inactive).map((vehicle) => vehicle.id),
  );
  const lastBookedAt = new Map<string, Date>();
  if (deactivatedIds.size > 0) {
    const latest = await prisma.order.groupBy({
      by: ["vehicleId"],
      where: {
        workspaceId: input.workspaceId,
        vehicleId: { in: [...deactivatedIds] },
        // A deleted booking says nothing about whether the car was
        // taking trips; a cancelled one does -- it was bookable.
        isArchived: false,
      },
      _max: { pickupDatetime: true },
    });
    for (const row of latest) {
      if (row._max.pickupDatetime) lastBookedAt.set(row.vehicleId, row._max.pickupDatetime);
    }
  }

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

      const findByPlate = (plate: string) =>
        fleet.find(
          (vehicle) =>
            vehicle.plateNumber &&
            foldLatinLookalikes(vehicle.plateNumber).toUpperCase() === plate,
        );

      // A plate the operator supplied wins outright: they can see what
      // the email cannot, and there is nothing here to second-guess
      // them with. Typed by a person, matched against a stored plate
      // that may have come from Turo -- so both sides are folded, or an
      // override typed with an ordinary A silently finds nothing.
      const overridePlate = input.plateOverrides?.[reservationId]
        ? foldLatinLookalikes(input.plateOverrides[reservationId].trim()).toUpperCase()
        : undefined;
      const overrideVehicle = overridePlate ? findByPlate(overridePlate) : undefined;

      if (overridePlate && !overrideVehicle) {
        outcome.unknownPlates.push({ reservationId, plate: overridePlate });
        continue;
      }

      const hintPlate =
        !overridePlate && input.plateHints?.[reservationId]
          ? foldLatinLookalikes(input.plateHints[reservationId].trim()).toUpperCase()
          : undefined;
      const hintVehicle = hintPlate ? findByPlate(hintPlate) : undefined;
      if (hintPlate && !hintVehicle) {
        outcome.unresolvedPlateHints.push({ reservationId, plate: hintPlate });
      }

      // Otherwise scope to the account the mail came from. This fleet
      // runs four Tesla Model Y 2020s and two Ford Explorer 2014s
      // across two accounts, so the account is often the only thing
      // that turns an ambiguous model into one car.
      //
      // A plate -- the operator's, or one the page showed -- is honoured
      // even on a deactivated car: it names the car. Everything else
      // goes through `placeBooking`, which never picks a deactivated
      // car. And a page plate that names no car of ours parks the
      // booking: the page has said which car it is, so matching by
      // model would be choosing a different one.
      const byPlate = overrideVehicle ?? hintVehicle;
      const modelMatches = byPlate
        ? []
        : matchVehiclesForEmail(facts.vehicleText, fleet, facts.coHostAccount).matches;
      const placement = byPlate
        ? ({ kind: "placed", vehicle: byPlate } as const)
        : hintPlate
          ? ({ kind: "pending", candidates: modelMatches.length, allDeactivated: false } as const)
          : placeBooking({
              matches: modelMatches,
              deactivatedIds,
              lastBookedAt,
              tripStart: facts.tripStart,
            });
      if (placement.kind === "pending" && facts.intent === "cancelled") {
        // Cancelled before it was ever placed. The basket exists to get
        // real trips onto the calendar, and this one will never run: it
        // would sit there asking for a car, and placing it by hand only
        // draws a cancelled strip. So it is left out, and one parked
        // before the cancellation arrived is taken back out. A CSV that
        // names its plate still records it, on the right car.
        if (input.apply) {
          await prisma.pendingOrder.deleteMany({
            where: { workspaceId: input.workspaceId, externalOrderId: reservationId },
          });
        }
        outcome.cancelledUnplaced += 1;
        continue;
      }
      if (placement.kind === "pending") {
        // Several cars of one model is normal here, and the mail names
        // no plate. Guessing would file a real booking against the
        // wrong vehicle, which shows up as a phantom conflict on the
        // calendar.
        //
        // But the trip is real whether or not we can place it, and a
        // calendar missing a booking that exists is its own kind of
        // wrong. So it is parked rather than dropped: visible,
        // assignable by hand, and picked up automatically the moment a
        // CSV names the plate or the fleet resolves the model.
        outcome.ambiguousVehicle.push({
          reservationId,
          vehicleText: facts.vehicleText,
          matches: placement.candidates,
          turoAccount: facts.coHostAccount,
        });

        if (input.apply) {
          const pending = {
            renterName: facts.guestName ?? "Turo guest",
            renterPhone: facts.guestPhone ?? null,
            pickupDatetime: facts.tripStart,
            returnDatetime: facts.tripEnd,
            pickupLocation: facts.location ?? null,
            status: statusFor(facts),
            vehicleText: facts.vehicleText,
            turoAccount: facts.coHostAccount ?? null,
            matchCount: placement.candidates,
          };
          await prisma.pendingOrder.upsert({
            where: {
              workspaceId_externalOrderId: {
                workspaceId: input.workspaceId,
                externalOrderId: reservationId,
              },
            },
            update: pending,
            create: {
              workspaceId: input.workspaceId,
              externalOrderId: reservationId,
              ...pending,
            },
          });
        }
        // Counted whether or not it was written: with `apply: false` the
        // counts describe what would happen, as `created` and `updated`
        // always have. This one alone used to read 0 on a dry run while
        // `ambiguousVehicle` listed the same bookings.
        outcome.pending += 1;
        continue;
      }

      const vehicle = placement.vehicle;
      touchedVehicles.add(vehicle.id);
      if (modelMatches.some((match) => deactivatedIds.has(match.id))) {
        outcome.placedPastDeactivated.push({ reservationId, vehicleId: vehicle.id });
      }

      if (input.apply) {
        const created = await prisma.order.create({
          data: {
            workspaceId: input.workspaceId,
            vehicleId: vehicle.id,
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
        ledgerOrders.add(created.id);
      }
      // It exists now, so it does not belong in the basket. Covers the
      // fleet-changed route; the CSV route clears its own on import.
      if (input.apply) {
        await prisma.pendingOrder.deleteMany({
          where: { workspaceId: input.workspaceId, externalOrderId: reservationId },
        });
      }

      outcome.created += 1;
      continue;
    }

    // The order exists, so nothing about this reservation is pending.
    if (input.apply) {
      await prisma.pendingOrder.deleteMany({
        where: { workspaceId: input.workspaceId, externalOrderId: reservationId },
      });
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

    if (data.pickupDatetime || data.returnDatetime) {
      const moved = await prisma.order.findUnique({
        where: { id: order.id },
        select: { vehicleId: true },
      });
      if (moved) touchedVehicles.add(moved.vehicleId);
    }

    if (input.apply) {
      await prisma.order.update({ where: { id: order.id }, data });
      if (data.pickupDatetime || data.returnDatetime || data.status) ledgerOrders.add(order.id);
    }
    outcome.updated += 1;
  }

  // After the writes, not during: reconciliation reads every live
  // booking on the vehicle, and doing it mid-loop would have it read a
  // half-applied picture.
  if (input.apply) {
    for (const vehicleId of touchedVehicles) {
      await reconcileVehicleConflicts(vehicleId);
    }
    for (const orderId of ledgerOrders) {
      await syncOrderOwnerLedger(orderId);
    }
  }
  outcome.conflictsRechecked = touchedVehicles.size;

  return outcome;
}

/**
 * A trip as the agent read it off Turo's trip page.
 *
 * `intent` follows the mail's vocabulary: `created` for a booked or
 * running trip, `changed` after a modification, `cancelled`, `ended`.
 * `earnings` may be sent but is never written, as with mail: the ledger
 * settles on the CSV's figure.
 */
export type TuroTripObservation = TuroOrderFacts & {
  /** Plate shown on the page, if any. A hint: see `applyTuroOrderFacts`. */
  plate?: string | null;
};

/**
 * Record what the agent saw, then apply it -- the entry point for the
 * agent's per-trip route.
 *
 * Recording first is the point. Mail is re-folded every five minutes and
 * wins on any unfinished trip, so an extension the agent saw on the page,
 * made in Turo's own interface and never emailed, would be moved back on
 * the next sync if it were only written to the order. Stored as a
 * snapshot, it is folded against the mail by time on every later sync
 * too, and keeps winning until something newer arrives.
 *
 * Applies only the reservations in `trips`, each re-derived from its
 * mail and its snapshot together, so the result is exactly what the next
 * full sync will produce for them. With `apply: false` nothing is stored
 * or written; the outcome says what would happen.
 */
export async function ingestTuroTripSnapshots(input: {
  workspaceId: string;
  actor?: string;
  apply: boolean;
  /** When the pages were read. Defaults to now. */
  observedAt?: Date;
  trips: TuroTripObservation[];
}): Promise<ApplyOutcome> {
  const observedAt = input.observedAt ?? new Date();
  const trips = input.trips.filter((trip) => trip.reservationId?.trim());
  const ids = [...new Set(trips.map((trip) => trip.reservationId.trim()))];

  const stored = ids.length
    ? await prisma.turoTripSnapshot.findMany({
        where: { workspaceId: input.workspaceId, reservationId: { in: ids } },
        select: { reservationId: true, observedAt: true, facts: true, plate: true },
      })
    : [];
  const latest = new Map<string, StoredSnapshot>(stored.map((row) => [row.reservationId, row]));

  // Only the mail that mentions these reservations; the fold below keeps
  // only the reservations asked about, so a stray number match is
  // harmless.
  const emails = ids.length
    ? await prisma.inboundEmail.findMany({
        where: {
          workspaceId: input.workspaceId,
          OR: ids.flatMap((id) => [{ bodyText: { contains: id } }, { subject: { contains: id } }]),
        },
        orderBy: { receivedAt: "asc" },
        select: { subject: true, bodyText: true, receivedAt: true },
      })
    : [];

  // What is known about each trip before this read: mail and earlier
  // reads folded, else the order as the CSV wrote it.
  const known = foldFacts([...mailEvents(emails), ...snapshotEvents(stored)]);
  const knownOrders = ids.length
    ? await prisma.order.findMany({
        where: { workspaceId: input.workspaceId, externalOrderId: { in: ids } },
        select: { externalOrderId: true, pickupDatetime: true, returnDatetime: true },
      })
    : [];
  const knownDates = new Map<string, { start: Date; end: Date }>();
  for (const order of knownOrders) {
    if (order.externalOrderId) {
      knownDates.set(order.externalOrderId, { start: order.pickupDatetime, end: order.returnDatetime });
    }
  }
  for (const [id, facts] of known) {
    if (facts.tripStart && facts.tripEnd) knownDates.set(id, { start: facts.tripStart, end: facts.tripEnd });
  }
  const suspectedTimezoneShift: { reservationId: string }[] = [];

  for (const trip of trips) {
    const { plate, ...facts } = trip;
    const reservationId = trip.reservationId.trim();
    const previous = latest.get(reservationId);

    // A read older than the one on file is not news. Keep the newer.
    if (previous && previous.observedAt.getTime() > observedAt.getTime()) continue;

    const before = knownDates.get(reservationId);
    if (
      before &&
      facts.tripStart &&
      facts.tripEnd &&
      isWallClockSentAsUtc(before.start, facts.tripStart) &&
      isWallClockSentAsUtc(before.end, facts.tripEnd)
    ) {
      suspectedTimezoneShift.push({ reservationId });
      continue;
    }

    // Merged over the last read with the same rule as mail, so a field
    // the page did not show this time does not erase one it showed before.
    const previousFacts = previous ? readSnapshotFacts(previous) : null;
    const merged =
      foldFacts([
        ...(previousFacts ? [{ at: previous!.observedAt, facts: previousFacts }] : []),
        { at: observedAt, facts: { ...facts, reservationId } },
      ]).get(reservationId) ?? { ...facts, reservationId };

    latest.set(reservationId, {
      reservationId,
      observedAt,
      facts: JSON.stringify(merged),
      plate: plate?.trim() || previous?.plate || null,
    });
  }

  if (input.apply) {
    for (const row of latest.values()) {
      await prisma.turoTripSnapshot.upsert({
        where: {
          workspaceId_reservationId: {
            workspaceId: input.workspaceId,
            reservationId: row.reservationId,
          },
        },
        create: { workspaceId: input.workspaceId, ...row },
        update: { observedAt: row.observedAt, facts: row.facts, plate: row.plate },
      });
    }
  }

  const snapshots = [...latest.values()];
  const folded = foldFacts([...mailEvents(emails), ...snapshotEvents(snapshots)]);
  const wanted = new Set(ids);

  const outcome = await applyTuroOrderFacts({
    workspaceId: input.workspaceId,
    facts: new Map([...folded].filter(([id]) => wanted.has(id))),
    apply: input.apply,
    actor: input.actor ?? "turo-agent",
    plateHints: snapshotPlates(snapshots),
  });
  return { ...outcome, suspectedTimezoneShift, scanned: trips.length };
}

/**
 * True when `sent` is `known`'s wall clock written as UTC: the trip page
 * says "10:00 AM", the agent sends "10:00:00Z", and the instant lands
 * seven or eight hours off. Read on the process clock, which is the
 * fleet's own zone -- the same clock the mail parser builds times on.
 *
 * Not a guess at intent: a real change moves a trip by days or to some
 * other hour, and it would have to move both ends by exactly the zone's
 * offset to be mistaken for this. Where the zone is UTC the two are the
 * same instant and nothing is ever flagged.
 */
function isWallClockSentAsUtc(known: Date, sent: Date) {
  const wallClockAsUtc = Date.UTC(
    known.getFullYear(),
    known.getMonth(),
    known.getDate(),
    known.getHours(),
    known.getMinutes(),
  );
  return wallClockAsUtc !== known.getTime() && sent.getTime() === wallClockAsUtc;
}
