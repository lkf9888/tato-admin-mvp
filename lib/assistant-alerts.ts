import "server-only";

import { AssistantAlertSeverity, OrderStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";

/**
 * Proactive alerts.
 *
 * Detection is plain code, deliberately. The model is not consulted
 * about whether something is wrong — only, elsewhere, about how to
 * phrase it. Two failure modes motivate that split:
 *
 *   - An alert that fires because a model hallucinated wastes the
 *     operator's attention and teaches them to ignore the feed.
 *   - An alert that fails to fire because a model had an off day is
 *     worse: the whole point is catching the thing you didn't notice.
 *
 * Every rule below is a deterministic query with a stable `dedupeKey`,
 * so a scan that runs every ten minutes updates one row per real-world
 * condition instead of stacking duplicates. When a condition stops
 * being true, its alert is resolved automatically — an alert list that
 * only grows is a list nobody reads.
 */

/**
 * How long a guest message can sit unanswered before it is worth
 * interrupting the operator. Turo guests expect fast replies and the
 * host's response time is scored, but a 20-minute-old message is not
 * yet a problem.
 */
const GUEST_REPLY_GRACE_HOURS = 2;

/**
 * A Gmail sync that has not succeeded in this long means the Turo
 * event stream is dark. That failure used to be entirely silent, which
 * is how a fleet ends up not knowing about a cancellation for a week.
 */
const SYNC_STALE_HOURS = 24;

/** Contracts left unsigned this long are usually forgotten, not pending. */
const CONTRACT_STALE_DAYS = 3;

export type AlertDraft = {
  dedupeKey: string;
  severity: AssistantAlertSeverity;
  title: string;
  body: string;
  href?: string;
};

export type AlertScanResult = {
  opened: number;
  updated: number;
  resolved: number;
  active: number;
};

function hoursAgo(hours: number) {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

function daysAgo(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function formatDateTime(value: Date) {
  return value.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** How many conflicting bookings to spell out before summarising. */
const CONFLICT_SAMPLE = 6;

/**
 * Booking conflicts — two *still-fixable* reservations on one vehicle.
 *
 * The date filter is the whole point. `hasConflict` is a stored flag
 * covering the entire imported history, and this fleet's history goes
 * back years, so an unfiltered query reported months of long-finished
 * trips as CRITICAL. A double-booking in March cannot be fixed in
 * August; surfacing it costs attention and teaches the operator that
 * red means nothing.
 *
 * A vehicle needs at least two conflicting bookings that have not
 * ended yet to qualify. One future booking whose overlapping partner
 * already came and went is not an open problem — that conflict has
 * already resolved itself, however badly.
 */
async function detectConflicts(workspaceId: string): Promise<AlertDraft[]> {
  const conflicts = await prisma.order.findMany({
    where: {
      workspaceId,
      isArchived: false,
      hasConflict: true,
      // Ongoing or upcoming only.
      returnDatetime: { gte: new Date() },
    },
    include: { vehicle: { select: { plateNumber: true, nickname: true } } },
    orderBy: { pickupDatetime: "asc" },
  });

  // Group by vehicle: two overlapping orders are one problem to solve,
  // not two alerts to dismiss.
  const byVehicle = new Map<string, typeof conflicts>();
  for (const order of conflicts) {
    const list = byVehicle.get(order.vehicleId) ?? [];
    list.push(order);
    byVehicle.set(order.vehicleId, list);
  }

  return [...byVehicle.entries()]
    .filter(([, orders]) => orders.length >= 2)
    .map(([vehicleId, orders]) => {
      const vehicle = orders[0].vehicle;
      const label = vehicle.plateNumber
        ? `${vehicle.plateNumber} · ${vehicle.nickname}`
        : vehicle.nickname;

      const lines = orders
        .slice(0, CONFLICT_SAMPLE)
        .map(
          (order) =>
            `${order.renterName} ${formatDateTime(order.pickupDatetime)} → ${formatDateTime(order.returnDatetime)}${order.externalOrderId ? ` (${order.externalOrderId})` : ""}`,
        );
      if (orders.length > CONFLICT_SAMPLE) {
        lines.push(`…还有 ${orders.length - CONFLICT_SAMPLE} 笔`);
      }

      return {
        dedupeKey: `conflict:${vehicleId}`,
        severity: AssistantAlertSeverity.CRITICAL,
        title: `${label} 有 ${orders.length} 笔订单时间冲突`,
        body: lines.join("\n"),
        href: "/calendar",
      };
    });
}

/** Turo guest messages that have gone unanswered past the grace period. */
/** Upper bound on messages examined per scan. See the note at the
 *  query below — the alert title reports how many of these need a
 *  reply, so the cap has to be well clear of a realistic backlog. */
const GUEST_MESSAGE_SCAN_CAP = 500;

async function detectUnansweredGuestMessages(workspaceId: string): Promise<AlertDraft[]> {
  const pending = await prisma.inboundEmail.findMany({
    where: {
      workspaceId,
      acknowledgedAt: null,
      receivedAt: { lte: hoursAgo(GUEST_REPLY_GRACE_HOURS) },
      kind: { in: ["GUEST_MESSAGE", "SUPPORT"] },
    },
    orderBy: { receivedAt: "asc" },
    // Raised from 50 because the title reports this list's length: at
    // the old cap a backlog of any size rendered as exactly "50 条",
    // which is a LIMIT echoed back as if it were a measurement. The
    // needsAction test reads a JSON column, so it cannot move into the
    // query and be counted in SQL; a generous ceiling with an explicit
    // "+" on overflow is the honest version.
    take: GUEST_MESSAGE_SCAN_CAP,
  });

  // Only the ones the extractor judged as needing a reply. A guest
  // saying "thanks, all good" is a guest message but not a task.
  const needsReply = pending.filter((email) => {
    if (!email.parsed) return true; // Unparsed: surface rather than swallow.
    try {
      return (JSON.parse(email.parsed) as { needsAction?: boolean }).needsAction === true;
    } catch {
      return true;
    }
  });

  if (needsReply.length === 0) return [];

  const oldest = needsReply[0];
  return [
    {
      dedupeKey: "guest_messages_unanswered",
      severity: AssistantAlertSeverity.WARNING,
      // `+` when the scan hit its ceiling, so a capped number never
      // reads as an exact count.
      title: `${needsReply.length}${pending.length >= GUEST_MESSAGE_SCAN_CAP ? "+" : ""} 条 Turo 消息等待回复`,
      body: needsReply
        .slice(0, 5)
        .map((email) => {
          const summary = email.parsed
            ? ((JSON.parse(email.parsed) as { summary?: string }).summary ?? email.subject)
            : email.subject;
          return `${formatDateTime(email.receivedAt)} · ${summary}`;
        })
        .join("\n"),
      href: "/assistant",
    },
  ].map((draft) => ({
    ...draft,
    // Escalate once the oldest has been sitting for more than a day —
    // Turo scores host response time.
    severity:
      oldest.receivedAt <= hoursAgo(24)
        ? AssistantAlertSeverity.CRITICAL
        : AssistantAlertSeverity.WARNING,
  }));
}

/** Staff tasks past their due time and still open. */
async function detectOverdueTasks(workspaceId: string): Promise<AlertDraft[]> {
  const overdue = await prisma.staffTask.findMany({
    where: {
      workspaceId,
      status: { in: ["todo", "in_progress"] },
      dueDatetime: { not: null, lte: new Date() },
    },
    include: { staff: { select: { name: true } } },
    orderBy: { dueDatetime: "asc" },
    take: 50,
  });

  if (overdue.length === 0) return [];

  return [
    {
      dedupeKey: "staff_tasks_overdue",
      severity: AssistantAlertSeverity.WARNING,
      title: `${overdue.length} 个员工任务已逾期`,
      body: overdue
        .slice(0, 5)
        .map(
          (task) =>
            `${task.title} · ${task.staff?.name ?? "未指派"}${task.dueDatetime ? ` · 应于 ${formatDateTime(task.dueDatetime)}` : ""}`,
        )
        .join("\n"),
      href: "/staff-schedule",
    },
  ];
}

/**
 * The Turo event stream has gone quiet.
 *
 * Distinguishes "never configured" from "configured but stalled" —
 * only the second is an alert. A fleet that has not set up the Gmail
 * inbox is not experiencing a failure.
 */
async function detectStaleInbox(workspaceId: string): Promise<AlertDraft[]> {
  const latest = await prisma.inboundEmail.findFirst({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });

  // Never synced at all: not an alert, just unconfigured.
  if (!latest) return [];
  if (latest.createdAt > hoursAgo(SYNC_STALE_HOURS)) return [];

  return [
    {
      dedupeKey: "inbox_stale",
      severity: AssistantAlertSeverity.WARNING,
      title: "Turo 邮件同步已停滞",
      body: `最后一次收到 Turo 邮件是 ${formatDateTime(latest.createdAt)}。可能是 Gmail 应用专用密码失效,或定时任务没有在跑——这段时间的订单变更和房客消息都不会出现在这里。`,
      href: "/assistant",
    },
  ];
}

/** CSV imports that partially failed. */
async function detectFailedImports(workspaceId: string): Promise<AlertDraft[]> {
  const batch = await prisma.importBatch.findFirst({
    where: { workspaceId, failedRows: { gt: 0 } },
    orderBy: { importedAt: "desc" },
    select: { id: true, fileName: true, failedRows: true, successRows: true, importedAt: true },
  });

  // Only alert on a recent one — an old partial import the operator
  // already looked at should not sit in the feed forever.
  if (!batch || batch.importedAt < daysAgo(7)) return [];

  return [
    {
      dedupeKey: `import_failed:${batch.id}`,
      severity: AssistantAlertSeverity.WARNING,
      title: `CSV 导入有 ${batch.failedRows} 行失败`,
      body: `${batch.fileName} · 成功 ${batch.successRows} 行,失败 ${batch.failedRows} 行 · ${formatDateTime(batch.importedAt)}。失败的行不会出现在日历和分账里。`,
      href: "/imports",
    },
  ];
}

/** Contracts sent but never signed. */
async function detectStaleContracts(workspaceId: string): Promise<AlertDraft[]> {
  const stale = await prisma.contractEnvelope.findMany({
    where: {
      workspaceId,
      status: { in: ["SENT", "PARTIALLY_SIGNED"] },
      createdAt: { lte: daysAgo(CONTRACT_STALE_DAYS) },
    },
    select: { id: true, title: true, createdAt: true },
    orderBy: { createdAt: "asc" },
    take: 20,
  });

  if (stale.length === 0) return [];

  return [
    {
      dedupeKey: "contracts_awaiting_signature",
      severity: AssistantAlertSeverity.INFO,
      title: `${stale.length} 份合同超过 ${CONTRACT_STALE_DAYS} 天未签署`,
      body: stale
        .slice(0, 5)
        .map((envelope) => `${envelope.title} · 发出于 ${formatDateTime(envelope.createdAt)}`)
        .join("\n"),
      href: "/contracts",
    },
  ];
}

/**
 * Run every detector and reconcile the alert table against reality.
 *
 * Idempotent by construction: existing alerts for a still-true
 * condition are updated in place (keeping their acknowledgement), and
 * alerts whose condition no longer holds are resolved.
 */
export async function runAlertScan(workspaceId: string): Promise<AlertScanResult> {
  const drafts = (
    await Promise.all([
      detectConflicts(workspaceId),
      detectUnansweredGuestMessages(workspaceId),
      detectOverdueTasks(workspaceId),
      detectStaleInbox(workspaceId),
      detectFailedImports(workspaceId),
      detectStaleContracts(workspaceId),
    ])
  ).flat();

  const existing = await prisma.assistantAlert.findMany({
    where: { workspaceId, resolvedAt: null },
  });
  const existingByKey = new Map(existing.map((alert) => [alert.dedupeKey, alert]));
  const draftKeys = new Set(drafts.map((draft) => draft.dedupeKey));

  let opened = 0;
  let updated = 0;

  for (const draft of drafts) {
    const current = existingByKey.get(draft.dedupeKey);

    if (!current) {
      await prisma.assistantAlert.upsert({
        where: { workspaceId_dedupeKey: { workspaceId, dedupeKey: draft.dedupeKey } },
        // A previously resolved alert whose condition returned: reopen
        // it rather than creating a second row, and clear both the
        // resolution and the acknowledgement so it surfaces again.
        update: {
          severity: draft.severity,
          title: draft.title,
          body: draft.body,
          href: draft.href ?? null,
          resolvedAt: null,
          acknowledgedAt: null,
          notifiedAt: null,
        },
        create: {
          workspaceId,
          dedupeKey: draft.dedupeKey,
          severity: draft.severity,
          title: draft.title,
          body: draft.body,
          href: draft.href ?? null,
        },
      });
      opened += 1;
      continue;
    }

    // Same condition, possibly different detail (one more overdue task,
    // a new conflicting booking). Refresh the text and severity but
    // keep `acknowledgedAt` — the operator said they had seen this.
    const changed =
      current.title !== draft.title ||
      current.body !== draft.body ||
      current.severity !== draft.severity;

    if (changed) {
      await prisma.assistantAlert.update({
        where: { id: current.id },
        data: {
          severity: draft.severity,
          title: draft.title,
          body: draft.body,
          href: draft.href ?? null,
          // Detail changed, so a prior acknowledgement no longer covers
          // what this alert now says. Re-surface it.
          acknowledgedAt: null,
          notifiedAt: null,
        },
      });
      updated += 1;
    }
  }

  const goneKeys = existing
    .filter((alert) => !draftKeys.has(alert.dedupeKey))
    .map((alert) => alert.id);

  if (goneKeys.length > 0) {
    await prisma.assistantAlert.updateMany({
      where: { id: { in: goneKeys } },
      data: { resolvedAt: new Date() },
    });
  }

  return {
    opened,
    updated,
    resolved: goneKeys.length,
    active: drafts.length,
  };
}

export async function listActiveAlerts(workspaceId: string) {
  return prisma.assistantAlert.findMany({
    where: { workspaceId, resolvedAt: null },
    orderBy: [{ severity: "desc" }, { updatedAt: "desc" }],
    take: 50,
  });
}
