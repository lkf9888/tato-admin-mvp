import "server-only";

import { z } from "zod";

import { prisma } from "@/lib/prisma";

/**
 * The phone assistant's list of what is still undone on Turo trips,
 * kept in TATO so it can be read where the rest of the business is.
 *
 * TATO decides none of it. Whether a trip is checked in, whether the
 * guest uploaded a licence, how many photos it has, whether an invoice
 * went out -- only the Turo app shows that, and only the assistant on
 * the phone reads the app. So the assistant pushes its whole open list
 * every sync and this file mirrors it: new codes open, known ones
 * update, codes missing from the push close. One set of rules, kept on
 * the assistant's console; a second copy here would drift.
 */

export const TURO_TASK_STAGES = [
  "before_pickup",
  "pickup",
  "on_trip",
  "after_return",
  "closing",
  "tickets",
  "fleet",
] as const;

export const TURO_TASK_SEVERITIES = ["info", "warning", "critical"] as const;
export type TuroTaskSeverity = (typeof TURO_TASK_SEVERITIES)[number];

/** A push larger than this is a bug on the sending side, not a fleet. */
export const TURO_TASK_PUSH_LIMIT = 500;

const isoDate = z
  .string()
  .trim()
  .refine((value) => !Number.isNaN(Date.parse(value)), "not a date");

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => value || null);

export const turoTaskSchema = z.object({
  /** The assistant's short id, unique among its open tasks: "F23". */
  code: z.string().trim().min(1).max(32),
  kind: z.string().trim().min(1).max(40),
  stage: z.enum(TURO_TASK_STAGES).nullish().transform((value) => value ?? null),
  title: z.string().trim().min(1).max(80),
  brief: z.string().trim().min(1).max(400),
  reservationId: optionalText(40),
  plate: optionalText(20),
  dueAt: isoDate.nullish().transform((value) => (value ? new Date(value) : null)),
  severity: z.enum(TURO_TASK_SEVERITIES).default("warning"),
  turoUrl: z
    .string()
    .trim()
    .url()
    .max(500)
    .refine((value) => /^https:\/\/([a-z0-9-]+\.)*turo\.com\//i.test(value), "not a turo.com link")
    .nullish()
    .transform((value) => value ?? null),
  openedAt: isoDate.transform((value) => new Date(value)),
  remindCount: z.number().int().min(0).max(10_000).default(0),
});

export const turoTaskPushSchema = z.object({
  /** When the assistant read the list -- its clock, not ours. */
  generatedAt: isoDate.nullish().transform((value) => (value ? new Date(value) : null)),
  tasks: z.array(turoTaskSchema).max(TURO_TASK_PUSH_LIMIT),
});

export type TuroTaskPush = z.infer<typeof turoTaskPushSchema>;

/**
 * Mirror one push. Every open code in it is upserted; every code open
 * here and absent from it is closed. An empty list is a real answer --
 * "nothing outstanding" -- and closes everything; the assistant only
 * pushes after a sync that read the app, so a failed sync sends nothing
 * rather than an empty list.
 */
export async function applyTuroTaskPush(workspaceId: string, push: TuroTaskPush, source: string | null) {
  const now = new Date();
  const codes = new Set<string>();
  const tasks = push.tasks.filter((task) => {
    if (codes.has(task.code)) return false;
    codes.add(task.code);
    return true;
  });

  const reservationIds = [...new Set(tasks.map((task) => task.reservationId).filter((id): id is string => Boolean(id)))];
  const orders = reservationIds.length
    ? await prisma.order.findMany({
        where: { workspaceId, externalOrderId: { in: reservationIds } },
        select: { id: true, externalOrderId: true, isArchived: true },
      })
    : [];
  // Prefer the live order when a reservation has an archived duplicate.
  const orderFor = new Map<string, string>();
  for (const order of orders.sort((a, b) => Number(a.isArchived) - Number(b.isArchived))) {
    if (order.externalOrderId && !orderFor.has(order.externalOrderId)) orderFor.set(order.externalOrderId, order.id);
  }

  const existing = await prisma.turoTask.findMany({
    where: { workspaceId },
    select: { code: true, resolvedAt: true },
  });
  const known = new Map(existing.map((row) => [row.code, row]));

  let opened = 0;
  let updated = 0;
  const writes = tasks.map((task) => {
    const before = known.get(task.code);
    if (!before || before.resolvedAt) opened += 1;
    else updated += 1;
    const data = {
      kind: task.kind,
      stage: task.stage,
      title: task.title,
      brief: task.brief,
      reservationId: task.reservationId,
      orderId: task.reservationId ? (orderFor.get(task.reservationId) ?? null) : null,
      plate: task.plate,
      dueAt: task.dueAt,
      severity: task.severity,
      turoUrl: task.turoUrl,
      openedAt: task.openedAt,
      remindCount: task.remindCount,
      lastSeenAt: now,
      resolvedAt: null,
    };
    return prisma.turoTask.upsert({
      where: { workspaceId_code: { workspaceId, code: task.code } },
      create: { workspaceId, code: task.code, ...data },
      update: data,
    });
  });

  const results = await prisma.$transaction([
    ...writes,
    prisma.turoTask.updateMany({
      where: { workspaceId, resolvedAt: null, code: { notIn: [...codes] } },
      data: { resolvedAt: now },
    }),
  ]);
  const closed = results[results.length - 1] as { count: number };

  await prisma.turoTaskFeed.upsert({
    where: { workspaceId },
    create: { workspaceId, lastPushAt: now, generatedAt: push.generatedAt, openCount: tasks.length, source },
    update: { lastPushAt: now, generatedAt: push.generatedAt, openCount: tasks.length, source },
  });

  return { received: push.tasks.length, open: tasks.length, opened, updated, resolved: closed.count };
}

const SEVERITY_RANK: Record<string, number> = { critical: 0, warning: 1, info: 2 };

/**
 * What is open now, most pressing first: overdue, then by how soon it is
 * due, then by severity. Tasks with no deadline go last.
 */
export async function listOpenTuroTasks(workspaceId: string) {
  const rows = await prisma.turoTask.findMany({ where: { workspaceId, resolvedAt: null } });
  const now = Date.now();
  return rows.sort((a, b) => {
    const aDue = a.dueAt?.getTime() ?? Number.POSITIVE_INFINITY;
    const bDue = b.dueAt?.getTime() ?? Number.POSITIVE_INFINITY;
    const aOver = aDue < now ? 0 : 1;
    const bOver = bDue < now ? 0 : 1;
    if (aOver !== bOver) return aOver - bOver;
    if (aDue !== bDue) return aDue - bDue;
    const bySeverity = (SEVERITY_RANK[a.severity] ?? 1) - (SEVERITY_RANK[b.severity] ?? 1);
    if (bySeverity) return bySeverity;
    return a.openedAt.getTime() - b.openedAt.getTime();
  });
}

/** For the navigation badge. */
export function countOpenTuroTasks(workspaceId: string) {
  return prisma.turoTask.count({ where: { workspaceId, resolvedAt: null } });
}

/**
 * When the list was last pushed. A push older than this means the phone
 * or the assistant is down and the list is no longer current -- say so
 * rather than show a stale "all clear". The assistant syncs every 15
 * minutes; an hour allows for a skipped round or two.
 */
export const TURO_TASK_FEED_STALE_MINUTES = 60;

export async function getTuroTaskFeed(workspaceId: string) {
  const feed = await prisma.turoTaskFeed.findUnique({ where: { workspaceId } });
  if (!feed) return null;
  return {
    lastPushAt: feed.lastPushAt,
    generatedAt: feed.generatedAt,
    openCount: feed.openCount,
    source: feed.source,
    stale: Date.now() - feed.lastPushAt.getTime() > TURO_TASK_FEED_STALE_MINUTES * 60_000,
  };
}
