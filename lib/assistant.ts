import "server-only";

import { InboundEmailKind, OrderStatus } from "@prisma/client";

import { kimiChat, type KimiMessage } from "@/lib/kimi";
import { prisma } from "@/lib/prisma";
import { getOrderNetEarning } from "@/lib/utils";

/**
 * The fleet assistant.
 *
 * Design constraint that shapes everything here: **the model never
 * queries the database and never takes an action.** This module gathers
 * a factual snapshot in plain code, hands it to the model as context,
 * and asks for prose. The model's only job is phrasing and reasoning
 * over numbers it was given.
 *
 * That is a deliberate trade. Tool-calling would let the assistant
 * answer a wider range of questions, but this system manages real money
 * and real vehicles: a model that can run its own queries can also
 * confidently report a number it derived wrongly, and a model that can
 * act can act wrongly. Snapshot-in / prose-out means a wrong answer is
 * a wrong *sentence about correct data*, which an operator can catch.
 *
 * Drafting outbound messages is supported; sending is not. Drafts come
 * back as text the operator copies or edits — nothing in this module
 * calls the email or SMS layer.
 */

const MAX_HISTORY_MESSAGES = 12;

function formatMoney(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `CA$${value.toFixed(2)}`;
}

function formatDate(value: Date) {
  // Deliberately explicit about zone: the container runs on the fleet's
  // operating timezone, and an assistant answer that says "tomorrow"
  // has to mean the operator's tomorrow.
  return value.toLocaleString("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export type AssistantSnapshot = {
  generatedAt: Date;
  text: string;
  /** Counts surfaced in the UI so the operator sees what was consulted. */
  summary: {
    vehicles: number;
    activeOrders: number;
    upcomingPickups: number;
    upcomingReturns: number;
    conflicts: number;
    unreadEmails: number;
    openTasks: number;
  };
};

/**
 * Everything the assistant is allowed to know, gathered in one pass.
 *
 * Sized to stay well inside the model's context while covering the
 * questions an operator actually asks: what's happening today, what's
 * wrong, what did I earn, who is waiting on me.
 */
export async function buildAssistantSnapshot(workspaceId: string): Promise<AssistantSnapshot> {
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const endOfWeek = new Date(startOfToday);
  endOfWeek.setDate(endOfWeek.getDate() + 7);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [
    vehicleCount,
    ownerCount,
    activeOrders,
    upcomingPickups,
    upcomingReturns,
    conflicts,
    monthOrders,
    unreadEmails,
    openTasks,
    lastImport,
  ] = await Promise.all([
    prisma.vehicle.count({ where: { workspaceId } }),
    prisma.owner.count({ where: { workspaceId } }),
    prisma.order.count({
      where: {
        workspaceId,
        isArchived: false,
        status: { notIn: [OrderStatus.cancelled, OrderStatus.completed] },
        pickupDatetime: { lte: now },
        returnDatetime: { gte: now },
      },
    }),
    prisma.order.findMany({
      where: {
        workspaceId,
        isArchived: false,
        status: { not: OrderStatus.cancelled },
        pickupDatetime: { gte: now, lte: endOfWeek },
      },
      include: { vehicle: { select: { plateNumber: true, nickname: true } } },
      orderBy: { pickupDatetime: "asc" },
      take: 25,
    }),
    prisma.order.findMany({
      where: {
        workspaceId,
        isArchived: false,
        status: { not: OrderStatus.cancelled },
        returnDatetime: { gte: now, lte: endOfWeek },
      },
      include: { vehicle: { select: { plateNumber: true, nickname: true } } },
      orderBy: { returnDatetime: "asc" },
      take: 25,
    }),
    prisma.order.findMany({
      where: { workspaceId, isArchived: false, hasConflict: true },
      include: { vehicle: { select: { plateNumber: true, nickname: true } } },
      orderBy: { pickupDatetime: "asc" },
      take: 20,
    }),
    prisma.order.findMany({
      where: {
        workspaceId,
        isArchived: false,
        status: { not: OrderStatus.cancelled },
        pickupDatetime: { gte: startOfMonth },
      },
      select: { totalPrice: true, sourceMetadata: true },
    }),
    prisma.inboundEmail.findMany({
      where: { workspaceId, acknowledgedAt: null },
      orderBy: { receivedAt: "desc" },
      take: 25,
    }),
    prisma.staffTask.findMany({
      where: { workspaceId, status: { in: ["todo", "in_progress"] } },
      include: {
        staff: { select: { name: true } },
        vehicle: { select: { plateNumber: true } },
      },
      orderBy: { dueDatetime: "asc" },
      take: 20,
    }),
    prisma.importBatch.findFirst({
      where: { workspaceId },
      orderBy: { importedAt: "desc" },
      select: { importedAt: true, successRows: true, failedRows: true, fileName: true },
    }),
  ]);

  const monthRevenue = monthOrders.reduce(
    (sum, order) => sum + (getOrderNetEarning(order.sourceMetadata, order.totalPrice) ?? 0),
    0,
  );

  const lines: string[] = [];
  lines.push(`Current time: ${formatDate(now)}`);
  lines.push(`Fleet: ${vehicleCount} vehicles, ${ownerCount} owners`);
  lines.push(`Currently on rent: ${activeOrders} vehicles`);
  lines.push(
    `Revenue this month (${startOfMonth.toLocaleDateString("en-CA", { month: "long", year: "numeric" })}): ${formatMoney(monthRevenue)} across ${monthOrders.length} trips`,
  );

  if (lastImport) {
    lines.push(
      `Last CSV import: ${formatDate(lastImport.importedAt)} — ${lastImport.fileName}, ${lastImport.successRows} rows ok, ${lastImport.failedRows} failed`,
    );
  } else {
    lines.push("Last CSV import: never");
  }

  lines.push("");
  lines.push(`## Pickups in the next 7 days (${upcomingPickups.length})`);
  if (upcomingPickups.length === 0) {
    lines.push("(none)");
  } else {
    for (const order of upcomingPickups) {
      lines.push(
        `- ${formatDate(order.pickupDatetime)} · ${order.vehicle.plateNumber} ${order.vehicle.nickname} · ${order.renterName} · ${order.status}${order.pickupLocation ? ` · pickup at ${order.pickupLocation}` : ""}`,
      );
    }
  }

  lines.push("");
  lines.push(`## Returns in the next 7 days (${upcomingReturns.length})`);
  if (upcomingReturns.length === 0) {
    lines.push("(none)");
  } else {
    for (const order of upcomingReturns) {
      lines.push(
        `- ${formatDate(order.returnDatetime)} · ${order.vehicle.plateNumber} ${order.vehicle.nickname} · ${order.renterName}`,
      );
    }
  }

  lines.push("");
  lines.push(`## Booking conflicts (${conflicts.length})`);
  if (conflicts.length === 0) {
    lines.push("(none)");
  } else {
    for (const order of conflicts) {
      lines.push(
        `- ${order.vehicle.plateNumber} ${order.vehicle.nickname} · ${order.renterName} · ${formatDate(order.pickupDatetime)} → ${formatDate(order.returnDatetime)} · reservation ${order.externalOrderId ?? "n/a"}`,
      );
    }
  }

  lines.push("");
  lines.push(`## Unread Turo emails (${unreadEmails.length})`);
  if (unreadEmails.length === 0) {
    lines.push("(none)");
  } else {
    for (const email of unreadEmails) {
      const parsed = email.parsed ? (JSON.parse(email.parsed) as { summary?: string; needsAction?: boolean }) : null;
      const flag = parsed?.needsAction ? " [NEEDS REPLY]" : "";
      lines.push(
        `- ${formatDate(email.receivedAt)} · ${email.kind}${flag} · ${parsed?.summary || email.subject}`,
      );
    }
  }

  lines.push("");
  lines.push(`## Open staff tasks (${openTasks.length})`);
  if (openTasks.length === 0) {
    lines.push("(none)");
  } else {
    for (const task of openTasks) {
      const overdue = task.dueDatetime && task.dueDatetime < now ? " [OVERDUE]" : "";
      lines.push(
        `- ${task.title}${overdue} · ${task.staff?.name ?? "unassigned"}${task.vehicle ? ` · ${task.vehicle.plateNumber}` : ""}${task.dueDatetime ? ` · due ${formatDate(task.dueDatetime)}` : ""}`,
      );
    }
  }

  return {
    generatedAt: now,
    text: lines.join("\n"),
    summary: {
      vehicles: vehicleCount,
      activeOrders,
      upcomingPickups: upcomingPickups.length,
      upcomingReturns: upcomingReturns.length,
      conflicts: conflicts.length,
      unreadEmails: unreadEmails.length,
      openTasks: openTasks.length,
    },
  };
}

function buildSystemPrompt(snapshot: AssistantSnapshot, operatorName: string) {
  return `You are the operations assistant for TATO, a Turo fleet management platform. You are helping ${operatorName}, who runs the fleet.

You will be given a factual snapshot of the fleet below. Follow these rules without exception:

1. Answer ONLY from the snapshot. If the snapshot does not contain the answer, say so plainly and suggest which page of TATO would have it. Never estimate, extrapolate, or invent a number, name, date, or reservation id.
2. You cannot take actions. You cannot send messages, change bookings, assign tasks, or modify any record. If asked to do something, explain what you can draft instead.
3. When asked to draft a message to a guest, owner, or staff member, write the draft and make clear it has not been sent — the operator must review and send it themselves.
4. Be concise. An operator checking their phone between car handovers wants two sentences, not five paragraphs.
5. Money is in Canadian dollars. Times are in the fleet's local timezone, already formatted in the snapshot.
6. Reply in the same language the operator writes in.

=== FLEET SNAPSHOT (generated ${formatDate(snapshot.generatedAt)}) ===
${snapshot.text}
=== END SNAPSHOT ===`;
}

export type AssistantReply =
  | { ok: true; content: string; snapshot: AssistantSnapshot }
  | { ok: false; reason: string };

/**
 * Answer one operator question.
 *
 * `history` is prior turns in this thread, oldest first. It is trimmed
 * to the most recent exchanges — the snapshot is regenerated on every
 * request, so old turns carry stale numbers and are only useful for
 * conversational continuity.
 */
export async function askAssistant(input: {
  workspaceId: string;
  operatorName: string;
  question: string;
  history: Array<{ role: "USER" | "ASSISTANT"; content: string }>;
}): Promise<AssistantReply> {
  const snapshot = await buildAssistantSnapshot(input.workspaceId);

  const messages: KimiMessage[] = [
    { role: "system", content: buildSystemPrompt(snapshot, input.operatorName) },
    ...input.history.slice(-MAX_HISTORY_MESSAGES).map((entry) => ({
      role: entry.role === "USER" ? ("user" as const) : ("assistant" as const),
      content: entry.content,
    })),
    { role: "user", content: input.question },
  ];

  const result = await kimiChat({ messages, temperature: 0.3, maxTokens: 1500 });
  if (!result.ok) {
    return { ok: false, reason: result.reason };
  }

  return { ok: true, content: result.content, snapshot };
}
