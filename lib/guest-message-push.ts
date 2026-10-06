import "server-only";

import { getAlertChannelStatus, guestMessageChannelKey, sendNotification } from "@/lib/notify-client";
import { prisma } from "@/lib/prisma";
import { isSmsConfigured, normalizeSmsPhone, sendSms } from "@/lib/sms";
import { getAppUrl } from "@/lib/stripe";

/**
 * New guest messages, pushed to the operator's phone.
 *
 * Turo scores how fast a host answers, and the mailbox is not something
 * anyone watches. So the moment the Gmail sync files a guest message,
 * this sends one line to the operator: who wrote, about which car, and
 * the start of what they said.
 *
 * WeChat first, because it is free. A WeChat subscribe message costs one
 * authorisation per send, topped up only when the mini program is
 * opened -- so a busy day can run the balance to zero. When no subscriber
 * can be reached, the same line goes out by SMS instead, so a run of
 * messages is never silently lost.
 *
 * Pushes are at least fifteen minutes apart; whatever arrives in between
 * goes out together in the next one. Nothing received before pushing
 * was switched on is ever pushed, so turning it on does not replay the
 * backlog.
 */

const BATCH_MINUTES = 15;
/** Never push mail older than this, whatever the cursor says: a
 *  backfill that re-ingests last month is not news. */
const MAX_AGE_HOURS = 24;
const CHANNEL_NAME = "TATO 客人消息";

export type GuestMessagePushResult =
  | { pushed: 0; reason: "disabled" | "nothing_new" | "batching" }
  | { pushed: number; via: "wechat" | "sms" | "none"; reason?: string };

type PendingMessage = {
  id: string;
  guestName: string;
  car: string | null;
  text: string;
  receivedAt: Date;
};

function oneLine(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function clip(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/**
 * Push whatever has arrived since the last push. Called at the end of
 * every Gmail sync; cheap when there is nothing to do, and never throws.
 */
export async function pushNewGuestMessages(input: {
  workspaceId: string;
  /** Skip the fifteen-minute spacing; for the settings panel's test. */
  ignoreBatching?: boolean;
  now?: Date;
}): Promise<GuestMessagePushResult> {
  try {
    return await push(input);
  } catch (error) {
    console.error("[guest-message-push] failed", error);
    return { pushed: 0, via: "none", reason: error instanceof Error ? error.message : "failed" };
  }
}

async function push(input: {
  workspaceId: string;
  ignoreBatching?: boolean;
  now?: Date;
}): Promise<GuestMessagePushResult> {
  const now = input.now ?? new Date();
  const setting = await prisma.guestMessageAlertSetting.findUnique({
    where: { workspaceId: input.workspaceId },
  });
  if (!setting?.enabled || !setting.enabledAt) return { pushed: 0, reason: "disabled" };

  const floor = new Date(
    Math.max(setting.enabledAt.getTime(), now.getTime() - MAX_AGE_HOURS * 3_600_000),
  );
  const rows = await prisma.inboundEmail.findMany({
    where: {
      workspaceId: input.workspaceId,
      kind: "GUEST_MESSAGE",
      pushedAt: null,
      // Answered already, in TATO or by marking it handled: not news.
      acknowledgedAt: null,
      receivedAt: { gte: floor },
    },
    orderBy: { receivedAt: "asc" },
    take: 50,
    select: {
      id: true,
      guestName: true,
      subject: true,
      guestText: true,
      guestTextZh: true,
      receivedAt: true,
      vehicle: { select: { brand: true, model: true, year: true, plateNumber: true } },
      order: { select: { vehicle: { select: { brand: true, model: true, year: true, plateNumber: true } } } },
    },
  });
  if (rows.length === 0) return { pushed: 0, reason: "nothing_new" };

  if (
    !input.ignoreBatching &&
    setting.lastSentAt &&
    now.getTime() - setting.lastSentAt.getTime() < BATCH_MINUTES * 60_000
  ) {
    return { pushed: 0, reason: "batching" };
  }

  const messages: PendingMessage[] = rows.map((row) => {
    // The trip names the exact car; the subject only the model.
    const vehicle = row.order?.vehicle ?? row.vehicle;
    return {
      id: row.id,
      guestName: oneLine(row.guestName) || "客人",
      car: vehicle ? `${vehicle.brand} ${vehicle.model} ${vehicle.year} · ${vehicle.plateNumber}` : null,
      // Chinese when the sync already has it: the operator reads Chinese.
      text: oneLine(row.guestTextZh) || oneLine(row.guestText) || oneLine(row.subject),
      receivedAt: row.receivedAt,
    };
  });

  const via = await deliver(input.workspaceId, setting.smsPhone, messages);

  // Marked even when nothing could deliver it: a message that failed to
  // push at noon is not worth a push at six, and an unconfigured channel
  // would otherwise grow a backlog that floods out the day it is fixed.
  await prisma.$transaction([
    prisma.inboundEmail.updateMany({
      where: { id: { in: messages.map((message) => message.id) } },
      data: { pushedAt: now },
    }),
    prisma.guestMessageAlertSetting.update({
      where: { workspaceId: input.workspaceId },
      data: via.via === "none" ? {} : { lastSentAt: now },
    }),
  ]);

  return { pushed: messages.length, ...via };
}

async function deliver(
  workspaceId: string,
  smsPhone: string | null,
  messages: PendingMessage[],
): Promise<{ via: "wechat" | "sms" | "none"; reason?: string }> {
  const newest = messages[messages.length - 1];
  const names = [...new Set(messages.map((message) => message.guestName))];
  const single = messages.length === 1;
  const link = `${getAppUrl()}/messages`;

  // One message: the guest and what they said. Several: how many, from
  // whom, and the newest in full -- the one most likely to need an answer.
  const title = single
    ? `${newest.guestName}：${clip(newest.text, 60)}`
    : `${messages.length} 条新客人消息：${clip(names.join("、"), 40)}`;
  const details = single ? newest.text : `最新 ${newest.guestName}：${newest.text}`;

  const wechat = await sendNotification({
    channel: guestMessageChannelKey(workspaceId),
    channelName: CHANNEL_NAME,
    template: "alert",
    priority: "high",
    dedupeKey: `guest-message:${newest.id}`,
    data: {
      title,
      vehicle: newest.car,
      due: newest.receivedAt,
      details: clip(details, 200),
      source: "Turo",
    },
    link: { url: link },
  });
  if (wechat.ok && wechat.deliveries.some((delivery) => delivery.status === "sent")) {
    return { via: "wechat" };
  }
  const wechatReason = wechat.ok
    ? wechat.deliveries.length === 0
      ? "no_wechat_subscriber"
      : `wechat_${wechat.deliveries.map((delivery) => delivery.status).join(",")}`
    : wechat.reason;

  if (!smsPhone) return { via: "none", reason: wechatReason };

  const body = [
    single ? "TATO 新客人消息" : `TATO ${messages.length} 条新客人消息`,
    `${newest.guestName}${newest.car ? ` · ${newest.car}` : ""}：${clip(newest.text, 120)}`,
    single ? null : `还有：${clip(names.filter((name) => name !== newest.guestName).join("、"), 60)}`,
    link,
  ]
    .filter(Boolean)
    .join("\n");
  const sms = await sendSms({ to: smsPhone, body, kind: "guest message" });
  return sms.ok ? { via: "sms" } : { via: "none", reason: `${wechatReason}; ${sms.reason}` };
}

export type GuestMessageAlertStatus = {
  enabled: boolean;
  smsPhone: string | null;
  smsConfigured: boolean;
  lastSentAt: string | null;
  wechat: Awaited<ReturnType<typeof getAlertChannelStatus>>;
};

export async function getGuestMessageAlertStatus(workspaceId: string): Promise<GuestMessageAlertStatus> {
  const [setting, wechat] = await Promise.all([
    prisma.guestMessageAlertSetting.findUnique({ where: { workspaceId } }),
    getAlertChannelStatus({ key: guestMessageChannelKey(workspaceId), name: CHANNEL_NAME }).catch(
      () => null,
    ),
  ]);
  return {
    enabled: Boolean(setting?.enabled),
    smsPhone: setting?.smsPhone ?? null,
    smsConfigured: isSmsConfigured(),
    lastSentAt: setting?.lastSentAt?.toISOString() ?? null,
    wechat,
  };
}

/**
 * Save the operator's choice. Switching on starts the clock: mail that
 * arrived before it is never pushed.
 */
export async function saveGuestMessageAlertSetting(input: {
  workspaceId: string;
  enabled: boolean;
  smsPhone: string | null;
}) {
  const smsPhone = input.smsPhone?.trim() ? normalizeSmsPhone(input.smsPhone) : null;
  if (input.smsPhone?.trim() && !smsPhone) return { ok: false as const, error: "INVALID_PHONE" };

  const existing = await prisma.guestMessageAlertSetting.findUnique({
    where: { workspaceId: input.workspaceId },
  });
  const turningOn = input.enabled && !existing?.enabled;
  await prisma.guestMessageAlertSetting.upsert({
    where: { workspaceId: input.workspaceId },
    create: {
      workspaceId: input.workspaceId,
      enabled: input.enabled,
      smsPhone,
      enabledAt: input.enabled ? new Date() : null,
    },
    update: {
      enabled: input.enabled,
      smsPhone,
      ...(turningOn ? { enabledAt: new Date() } : {}),
    },
  });
  return { ok: true as const };
}

/** One sample line through the real channels, so the operator can see it arrive. */
export async function sendGuestMessageAlertTest(workspaceId: string) {
  const setting = await prisma.guestMessageAlertSetting.findUnique({ where: { workspaceId } });
  return deliver(workspaceId, setting?.smsPhone ?? null, [
    {
      id: `test-${Date.now()}`,
      guestName: "测试",
      car: null,
      text: "这是一条测试推送。客人发来新消息时，你会收到这样一条。",
      receivedAt: new Date(),
    },
  ]);
}
