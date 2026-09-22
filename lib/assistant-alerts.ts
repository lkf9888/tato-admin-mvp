import "server-only";

import { AssistantAlertSeverity, OrderSource, OrderStatus } from "@prisma/client";

import { formatBytes, getDiskUsage } from "@/lib/disk";
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

/** How many unblocked bookings to name before the list stops helping. */
const TURO_BLOCK_SAMPLE = 20;

/** The stamp `lib/direct-booking-server.ts` writes into
 *  `Order.sourceMetadata`. Matching the raw JSON is crude, and it is
 *  what SQLite gives us -- there is no JSON path operator to filter
 *  on, and pulling every offline order into memory to parse it would
 *  scale with the whole history rather than with what is upcoming. */
const DIRECT_BOOKING_CHANNEL_MARKER = '"channel":"direct-booking"';

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

/**
 * A date with no time on it.
 *
 * Direct bookings are date-only and stored at UTC midday precisely so
 * that no timezone can shift the day. Rendering a clock beside one
 * invents a precision the booking never had -- and in Vancouver it
 * would read 05:00, which looks like a bug.
 */
function formatDateOnly(value: Date) {
  return value.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
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
/** Warn here; act well before here. */
const DISK_WARN_PERCENT = 75;
const DISK_CRITICAL_PERCENT = 88;

/**
 * The volume filling up.
 *
 * This is the one failure on the list that has already happened: the
 * disk filled, the pre-deploy `cp` hit ENOSPC, `set -eu` aborted the
 * entrypoint before the server started, and the container crash-looped
 * until someone noticed. The entrypoint tolerates that failure now,
 * which means the next time it happens the site stays up and uploads
 * simply start failing -- quieter, and in some ways worse.
 *
 * Nothing deletes files. Every photo, receipt and signed contract ever
 * uploaded is still there, including ones an operator has "deleted",
 * since that path only sets `isArchived`. So this number only goes up,
 * and the only useful thing to do about it is say so early enough that
 * there is time to decide.
 *
 * Not workspace-scoped: a full disk is a property of the machine, not
 * of a tenant. On a single-tenant deployment that distinction costs
 * nothing and keeps the alert honest.
 */
async function detectDiskPressure(): Promise<AlertDraft[]> {
  const usage = await getDiskUsage();
  if (!usage || usage.usedPercent < DISK_WARN_PERCENT) return [];

  const critical = usage.usedPercent >= DISK_CRITICAL_PERCENT;

  return [
    {
      dedupeKey: "disk_pressure",
      severity: critical ? AssistantAlertSeverity.CRITICAL : AssistantAlertSeverity.WARNING,
      title: `存储空间已用 ${usage.usedPercent}%`,
      body: [
        `已用 ${formatBytes(usage.usedBytes)} / 共 ${formatBytes(usage.totalBytes)}，剩余 ${formatBytes(usage.freeBytes)}。`,
        "上传的照片、收据和合同不会被自动清理——界面上的删除只是隐藏，文件仍占用空间。",
        critical
          ? "磁盘写满会让上传失败，并可能导致部署中断。请尽快清理或扩容。"
          : "现在还有余量，但这个数字只会上升。",
      ].join("\n"),
      href: "/documents",
    },
  ];
}

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

  // What we said, and when. Turo sends no notification when the host
  // replies, so before the browser reader existed this could only ever
  // ask "has anyone marked it handled in TATO" -- and a message
  // answered on Turo an hour ago stayed on the list until somebody
  // came back here and ticked it. Where a conversation has been read
  // back, the honest test is whether our last word came after theirs.
  const replies = await prisma.turoConversationMessage.groupBy({
    by: ["reservationId"],
    where: { workspaceId, direction: "outbound" },
    _max: { sentAt: true },
  });
  const lastReplyAt = new Map(
    replies.map((row) => [row.reservationId, row._max.sentAt ?? new Date(0)]),
  );

  // Only the ones the extractor judged as needing a reply. A guest
  // saying "thanks, all good" is a guest message but not a task.
  const needsReply = pending.filter((email) => {
    // Answered since. Only decides anything for reservations the
    // reader has actually reached; everywhere else `lastReplyAt` has
    // no entry and the acknowledgement rules below still apply.
    const reservationId = (() => {
      if (!email.parsed) return null;
      try {
        return (JSON.parse(email.parsed) as { reservationId?: string }).reservationId ?? null;
      } catch {
        return null;
      }
    })();
    if (reservationId) {
      const repliedAt = lastReplyAt.get(reservationId);
      if (repliedAt && repliedAt > email.receivedAt) return false;
    }

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
 * Direct-site bookings whose dates may still be open on Turo.
 *
 * Turo has no public API, publishes no iCal, and blocks automated
 * traffic, so nothing here can close a car's Turo calendar and nothing
 * can read whether somebody already did. A booking taken on the
 * operator's own site therefore leaves a window in which the same car
 * can be booked again on Turo, and the only thing that closes it is a
 * person going to Turo and blocking the dates by hand.
 *
 * So this is a reminder, and it is a *detector* rather than something
 * the checkout webhook fires, on purpose. A webhook fires once: if it
 * fails, nobody is ever told, and if the trip is later cancelled or
 * moved, whatever it created still names the old dates. A query cannot
 * miss a booking and cannot go stale -- and it covers the bookings
 * taken before this existed.
 *
 * One alert per booking, never one for all of them. An aggregate would
 * be acknowledged once and then silently absorb the next booking,
 * which is the failure this whole file exists to avoid.
 *
 * Acknowledging is what "I have blocked it on Turo" means here,
 * because that fact lives only on Turo and cannot be read back. Change
 * the dates and the text changes, which clears the acknowledgement and
 * surfaces it again -- correctly, since the dates blocked on Turo are
 * now the wrong ones.
 *
 * Cars that are not on Turo are skipped. A fleet listed nowhere else
 * would otherwise collect a permanent, unresolvable warning for every
 * sale its own website made.
 */
async function detectUnblockedTuroDates(workspaceId: string): Promise<AlertDraft[]> {
  const bookings = await prisma.order.findMany({
    where: {
      workspaceId,
      source: OrderSource.offline,
      isArchived: false,
      status: { not: OrderStatus.cancelled },
      // A trip that has ended cannot be double-booked any more.
      returnDatetime: { gte: new Date() },
      // Written by the checkout webhook. An offline order typed in by
      // hand is not this -- it never touched a public site, so there
      // was no race with Turo to warn about.
      sourceMetadata: { contains: DIRECT_BOOKING_CHANNEL_MARKER },
    },
    select: {
      id: true,
      renterName: true,
      pickupDatetime: true,
      returnDatetime: true,
      vehicleId: true,
      vehicle: {
        select: {
          plateNumber: true,
          nickname: true,
          turoListingName: true,
          turoVehicleCode: true,
        },
      },
    },
    orderBy: { pickupDatetime: "asc" },
    take: TURO_BLOCK_SAMPLE,
  });

  if (bookings.length === 0) return [];

  // Two ways to know a car is on Turo, and the second is the stronger
  // one: a listing name can be left blank, but trips do not arrive
  // from a marketplace the car is not on.
  const candidateIds = Array.from(new Set(bookings.map((booking) => booking.vehicleId)));
  const withTuroTrips = await prisma.order.findMany({
    where: {
      workspaceId,
      vehicleId: { in: candidateIds },
      source: OrderSource.turo,
    },
    select: { vehicleId: true },
    distinct: ["vehicleId"],
  });
  const onTuro = new Set(withTuroTrips.map((order) => order.vehicleId));

  return bookings
    .filter(
      (booking) =>
        onTuro.has(booking.vehicleId) ||
        Boolean(booking.vehicle.turoListingName) ||
        Boolean(booking.vehicle.turoVehicleCode),
    )
    .map((booking) => ({
      dedupeKey: `turo_block:${booking.id}`,
      severity: AssistantAlertSeverity.WARNING,
      title: `请在 Turo 上封锁 ${booking.vehicle.plateNumber} 的 ${formatDateOnly(booking.pickupDatetime)}–${formatDateOnly(booking.returnDatetime)}`,
      body: [
        `${booking.vehicle.nickname} 已被 ${booking.renterName} 通过自建网站预订。`,
        "这辆车同时在 Turo 上架，而 Turo 没有可写入的接口 —— 需要有人手动把这几天设为不可预订，否则同一台车可能被二次预订。",
        "封锁完成后点「知道了」，这条提醒就会停止；改期会让它重新出现。",
      ].join("\n"),
      href: `/orders/${booking.id}`,
    }));
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
      detectUnblockedTuroDates(workspaceId),
      detectDiskPressure(),
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
