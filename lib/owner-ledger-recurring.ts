import "server-only";

import { OwnerLedgerKind, Prisma } from "@prisma/client";

import { utcToZonedDate, zonedDateTimeToUtc } from "@/lib/booking-time";
import { prisma } from "@/lib/prisma";

/**
 * Charges the operator pays on a schedule and bills to the owner --
 * insurance, parking, a GPS subscription, a loan or lease, plates.
 *
 * A rule writes one EXPENSE_REIMBURSEMENT row per occurrence, up to today
 * on the fleet's clock. It runs once a day on a schedule and again
 * whenever an owner's ledger or balance is shown, so a charge due this
 * morning is there before the scheduled run gets to it. Each row's id is
 * fixed per rule and day, so overlapping runs cannot write an occurrence
 * twice -- the insert of the second one fails on the key and is skipped.
 *
 * Deleting any row a rule wrote stops the rule for good. The row is gone
 * from the ledger, and a rule that kept going would write the next one as
 * if nothing had been said.
 */

export const RECURRING_INTERVALS = ["WEEKLY", "MONTHLY"] as const;
export type RecurringInterval = (typeof RECURRING_INTERVALS)[number];

export function isRecurringInterval(value: unknown): value is RecurringInterval {
  return value === "WEEKLY" || value === "MONTHLY";
}

/** At most this many rows per rule per run, so a start date typed years back cannot flood a ledger. */
const MAX_PER_RUN = 120;

function shiftDay(key: string, days: number) {
  const date = new Date(`${key}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * The nth occurrence of a rule (0 is the start date).
 *
 * MONTHLY keeps the start date's day of the month and uses the month's
 * last day when the month is shorter: a rule started on the 31st charges
 * on Apr 30, then on May 31 again, rather than drifting to the 30th.
 */
export function occurrenceOn(startOn: string, interval: RecurringInterval, n: number): string {
  if (interval === "WEEKLY") return shiftDay(startOn, 7 * n);
  const [year, month, day] = startOn.split("-").map(Number);
  const monthIndex = month - 1 + n;
  const targetYear = year + Math.floor(monthIndex / 12);
  const targetMonth = ((monthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return `${targetYear}-${String(targetMonth + 1).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}

/**
 * Occurrences after `lastOn`, up to and including `todayKey`, oldest
 * first. From occurrence 0, so a rule whose start day has not come yet
 * (`lastOn` the day before it) writes its start day when it arrives.
 */
export function dueOccurrences(
  rule: { startOn: string; lastOn: string; interval: RecurringInterval },
  todayKey: string,
) {
  const due: string[] = [];
  for (let n = 0; due.length < MAX_PER_RUN; n += 1) {
    const key = occurrenceOn(rule.startOn, rule.interval, n);
    if (key > todayKey) break;
    if (key > rule.lastOn) due.push(key);
  }
  return due;
}

/** The first occurrence after `lastOn`: what the ledger shows as the next charge. */
export function nextOccurrence(rule: { startOn: string; lastOn: string; interval: RecurringInterval }) {
  for (let n = 0; n < 10_000; n += 1) {
    const key = occurrenceOn(rule.startOn, rule.interval, n);
    if (key > rule.lastOn) return key;
  }
  return rule.lastOn;
}

/** The row id for one occurrence. */
export function recurringItemId(ruleId: string, day: string) {
  return `${ruleId}_${day}`;
}

/** A calendar day as the ledger stores it: noon on the fleet's clock. */
export function ledgerDayInstant(day: string) {
  return zonedDateTimeToUtc(day, "12:00") ?? new Date(`${day}T19:00:00.000Z`);
}

type Rule = Prisma.OwnerLedgerRecurringExpenseGetPayload<object>;

/**
 * Write one occurrence. False when it was already there -- another run got
 * to it first -- which is not an error.
 */
async function writeOccurrence(rule: Rule, day: string, vehicleId: string | null) {
  try {
    await prisma.ownerLedgerItem.create({
      data: {
        id: recurringItemId(rule.id, day),
        workspaceId: rule.workspaceId,
        ownerId: rule.ownerId,
        vehicleId,
        kind: OwnerLedgerKind.EXPENSE_REIMBURSEMENT,
        amount: rule.amount,
        occurredAt: ledgerDayInstant(day),
        note: rule.note,
        isAuto: false,
        recurringExpenseId: rule.id,
      },
    });
    return true;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return false;
    throw error;
  }
}

/**
 * Write every due occurrence of every running rule: all workspaces (the
 * scheduled run), one workspace (the owners list), or one owner (their
 * ledger). Returns how many rows were written.
 */
export async function materializeRecurringExpenses(
  scope: { workspaceId?: string; ownerId?: string } = {},
  now = new Date(),
) {
  const rules = await prisma.ownerLedgerRecurringExpense.findMany({
    where: {
      stoppedAt: null,
      ...(scope.workspaceId ? { workspaceId: scope.workspaceId } : {}),
      ...(scope.ownerId ? { ownerId: scope.ownerId } : {}),
    },
  });
  if (rules.length === 0) return 0;

  const todayKey = utcToZonedDate(now);
  // A car moved to another owner since the rule was made is not this
  // owner's any more; the charge still lands, just not tied to that car.
  const vehicleIds = [...new Set(rules.map((rule) => rule.vehicleId).filter((id): id is string => Boolean(id)))];
  const vehicles = vehicleIds.length
    ? await prisma.vehicle.findMany({ where: { id: { in: vehicleIds } }, select: { id: true, ownerId: true } })
    : [];
  const ownerOfVehicle = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle.ownerId]));

  let written = 0;
  for (const rule of rules) {
    if (!isRecurringInterval(rule.interval)) continue;
    const due = dueOccurrences(rule as Rule & { interval: RecurringInterval }, todayKey);
    if (due.length === 0) continue;
    const vehicleId = rule.vehicleId && ownerOfVehicle.get(rule.vehicleId) === rule.ownerId ? rule.vehicleId : null;
    for (const day of due) {
      if (await writeOccurrence(rule, day, vehicleId)) written += 1;
    }
    // Only forward: a slower overlapping run must not move it back.
    await prisma.ownerLedgerRecurringExpense.updateMany({
      where: { id: rule.id, lastOn: { lt: due[due.length - 1] } },
      data: { lastOn: due[due.length - 1] },
    });
  }
  return written;
}

/**
 * Start a rule from the charge being entered now: that charge is the
 * first occurrence, and the rest up to today are written straight away.
 */
export async function createRecurringExpense(input: {
  workspaceId: string;
  ownerId: string;
  vehicleId: string | null;
  amount: number;
  note: string;
  interval: RecurringInterval;
  startOn: string;
  createdBy: string;
}) {
  // Nothing written yet: `lastOn` the day before the start, so the start
  // day is the first one due -- today if it has come, or when it does.
  const rule = await prisma.ownerLedgerRecurringExpense.create({
    data: {
      workspaceId: input.workspaceId,
      ownerId: input.ownerId,
      vehicleId: input.vehicleId,
      amount: input.amount,
      note: input.note,
      interval: input.interval,
      startOn: input.startOn,
      lastOn: shiftDay(input.startOn, -1),
      createdBy: input.createdBy,
    },
  });
  await materializeRecurringExpenses({ ownerId: input.ownerId });
  return rule;
}

/** A row a rule wrote was deleted: the rule stops. */
export async function stopRuleForDeletedItem(item: { recurringExpenseId: string | null }) {
  if (!item.recurringExpenseId) return;
  await prisma.ownerLedgerRecurringExpense.updateMany({
    where: { id: item.recurringExpenseId, stoppedAt: null },
    data: { stoppedAt: new Date(), stoppedReason: "occurrence_deleted" },
  });
}
