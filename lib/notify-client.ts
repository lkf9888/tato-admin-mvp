import "server-only";

import { prisma } from "@/lib/prisma";
import { notify, type NotifyInput } from "@/lib/notify-hub/dispatch";

/**
 * How a sending system reaches the hub.
 *
 * The hub runs inside this app today, so the default transport is a
 * direct call -- a localhost round trip to ourselves would buy nothing
 * but a second way to fail. Set `NOTIFY_HUB_URL` and the same request
 * goes over HTTP instead, which is what HostHub and the wash bay
 * already do and what this app will do the day the hub moves out.
 *
 * Both transports take and return the same shapes, so the switch is a
 * deployment decision rather than a code change.
 */

export type NotifyDeliveryStatus = "sent" | "no_quota" | "muted" | "duplicate" | "failed";

export type NotifyClientResult = {
  /** False when the hub is unreachable, unconfigured or refused the call. */
  ok: boolean;
  /** Why, when it is not ok. Never thrown -- see sendNotification. */
  reason?: string;
  deliveries: { openId: string; status: NotifyDeliveryStatus }[];
};

function getHubUrl() {
  return process.env.NOTIFY_HUB_URL?.trim().replace(/\/$/, "") || "";
}

function getAppKey() {
  return process.env.NOTIFY_APP_KEY?.trim() || "tato";
}

async function sendOverHttp(url: string, input: NotifyInput): Promise<NotifyClientResult> {
  const apiKey = process.env.NOTIFY_HUB_API_KEY?.trim();
  if (!apiKey) return { ok: false, reason: "NOTIFY_HUB_API_KEY_MISSING", deliveries: [] };

  const response = await fetch(`${url}/api/v1/notify`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(input),
    // A task assignment must not hang on the hub. The email and SMS
    // legs have already gone out by the time this runs.
    signal: AbortSignal.timeout(10_000),
  });

  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
    deliveries?: { openId: string; status: NotifyDeliveryStatus }[];
  };

  if (!response.ok && response.status !== 207) {
    return { ok: false, reason: payload.error ?? `HTTP_${response.status}`, deliveries: [] };
  }

  return { ok: true, deliveries: payload.deliveries ?? [] };
}

async function sendInProcess(input: NotifyInput): Promise<NotifyClientResult> {
  const appKey = getAppKey();
  const app = await prisma.notifyApp.findUnique({
    where: { key: appKey },
    include: { miniProgram: { select: { isActive: true } } },
  });

  if (!app || !app.isActive) {
    return { ok: false, reason: `NOTIFY_APP_NOT_CONFIGURED:${appKey}`, deliveries: [] };
  }

  // No API key is checked on this path and none should be: the caller
  // is this process, holding the same database. The key exists to tell
  // *remote* systems apart, and inventing one for ourselves would only
  // be a secret to lose.
  const outcome = await notify(
    {
      appId: app.id,
      appKey: app.key,
      appName: app.name,
      miniProgramId: app.miniProgramId,
      apiKeyId: "in-process",
    },
    input,
  );

  if (!outcome.ok) return { ok: false, reason: outcome.error, deliveries: [] };
  return {
    ok: true,
    deliveries: outcome.deliveries.map((delivery) => ({
      openId: delivery.openId,
      status: delivery.status,
    })),
  };
}

/**
 * Send, and never throw.
 *
 * A notification is the last thing that happens when a task is saved,
 * and it is strictly less important than the save. An unreachable hub,
 * a missing key, a mini program with no secret configured -- all of
 * these have to come back as a result the caller can log, not as an
 * exception that turns a successful assignment into a 500.
 */
export async function sendNotification(input: NotifyInput): Promise<NotifyClientResult> {
  try {
    const url = getHubUrl();
    return url ? await sendOverHttp(url, input) : await sendInProcess(input);
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "NOTIFY_CLIENT_FAILED",
      deliveries: [],
    };
  }
}

/**
 * The channel a staff member's task notifications go to.
 *
 * One channel per person rather than per role, because TATO assigns
 * tasks to individuals. HostHub will key its own channels differently
 * and neither needs to know.
 */
export function staffChannelKey(staffId: string) {
  return `staff:${staffId}`;
}

/**
 * Transitional: keep the old mini program working against the new hub.
 *
 * The mini program in `wechat-miniprogram/` predates the hub. It binds
 * a person by staff code and reports an authorisation to
 * `/api/wechat/staff/subscribe`, neither of which the hub hears about
 * -- so without this bridge, switching TATO to the hub would leave the
 * only client that exists granting quota into a void.
 *
 * These write hub tables directly, which a real caller may not do. That
 * is the cost of the transition and the reason they are marked: once
 * the mini program speaks `/v1/mp/bind` and `/v1/mp/subscribe`, both
 * functions and their callers come out.
 */

async function resolveLocalApp() {
  // Only meaningful while the hub is in-process. Once it is remote,
  // the bridge cannot reach its tables -- and by then the mini program
  // will be talking to it directly, which is the point.
  if (getHubUrl()) return null;
  const app = await prisma.notifyApp.findUnique({ where: { key: getAppKey() } });
  return app && app.isActive ? app : null;
}

/** Give a staff member's hub channel a subscriber. Idempotent. */
export async function bridgeStaffSubscription(input: {
  staffId: string;
  staffName: string;
  openId: string;
}) {
  const app = await resolveLocalApp();
  if (!app) return;

  const { ensureChannel } = await import("@/lib/notify-hub/channels");
  const channel = await ensureChannel({
    appId: app.id,
    key: staffChannelKey(input.staffId),
    name: input.staffName,
  });

  await prisma.notifySubscription.upsert({
    where: { channelId_openId: { channelId: channel.id, openId: input.openId } },
    create: { channelId: channel.id, openId: input.openId, label: input.staffName },
    update: { mutedUntil: null },
  });
}

/** Record an authorisation the old mini program collected. */
export async function bridgeStaffQuotaGrant(openId: string) {
  const app = await resolveLocalApp();
  if (!app) return;

  const { grantQuota } = await import("@/lib/notify-hub/quota");
  await grantQuota({
    miniProgramId: app.miniProgramId,
    openId,
    templateKeys: ["task"],
  });
}

export type StaffChannelStatus = {
  bindCode: string;
  /** How many WeChat accounts are on this person's channel. */
  subscribers: number;
  /** Unspent task authorisations across those accounts. Zero means the
   *  next assignment will not reach them. */
  remaining: number;
};

/**
 * Channel state for the staff schedule, keyed by staff id.
 *
 * Reads hub tables directly, for the same reason and with the same
 * caveat as the bridge above: there is no admin API yet, and when the
 * hub moves out this becomes an HTTP call. Returns an empty map rather
 * than throwing when the hub is remote or unprovisioned -- the schedule
 * is a page about tasks, and it must render when notifications are not
 * configured at all.
 */
export async function getStaffChannelStatus(
  staff: { id: string; name: string }[],
): Promise<Map<string, StaffChannelStatus>> {
  const result = new Map<string, StaffChannelStatus>();
  if (staff.length === 0) return result;

  const app = await resolveLocalApp();
  if (!app) return result;

  const keyByStaffId = new Map(staff.map((member) => [staffChannelKey(member.id), member.id]));

  // One query for what exists, then create only what is missing. The
  // page renders on every visit and most visits create nothing.
  const existing = await prisma.notifyChannel.findMany({
    where: { appId: app.id, key: { in: [...keyByStaffId.keys()] } },
    include: { subscriptions: { select: { openId: true } } },
  });
  const existingKeys = new Set(existing.map((channel) => channel.key));

  const { ensureChannel } = await import("@/lib/notify-hub/channels");
  const created = [];
  for (const member of staff) {
    const key = staffChannelKey(member.id);
    if (existingKeys.has(key)) continue;
    created.push({
      ...(await ensureChannel({ appId: app.id, key, name: member.name })),
      subscriptions: [] as { openId: string }[],
    });
  }

  const channels = [...existing, ...created];
  const openIds = channels.flatMap((channel) => channel.subscriptions.map((s) => s.openId));

  const quotas = openIds.length
    ? await prisma.notifySubscribeQuota.findMany({
        where: { miniProgramId: app.miniProgramId, templateKey: "task", openId: { in: openIds } },
      })
    : [];
  const remainingByOpenId = new Map(quotas.map((row) => [row.openId, row.remaining]));

  for (const channel of channels) {
    const staffId = keyByStaffId.get(channel.key);
    if (!staffId) continue;
    result.set(staffId, {
      bindCode: channel.bindCode,
      subscribers: channel.subscriptions.length,
      remaining: channel.subscriptions.reduce(
        (sum, subscription) => sum + (remainingByOpenId.get(subscription.openId) ?? 0),
        0,
      ),
    });
  }

  return result;
}
