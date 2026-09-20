import "server-only";

import { prisma } from "@/lib/prisma";

import type { NotifyAppContext } from "./auth";
import { ensureChannel } from "./channels";
import { clearQuota, refundQuota, spendQuota, type Priority } from "./quota";
import {
  formatFieldValue,
  getMiniProgramCredentials,
  sendSubscribeMessage,
} from "./wechat";

/**
 * One call in, one message per subscriber out.
 *
 * Everything a caller is allowed to say is in `NotifyInput`, and none
 * of it is WeChat-shaped: no template id, no `thing3`, no mini program
 * path. That is the point of the hub -- the day HostHub moves to its
 * own appid with its own template ids, HostHub's code does not change.
 */

export type NotifyInput = {
  /** Channel key within the calling app, e.g. "cleaning" or "staff:cl9x". */
  channel: string;
  /** Display name, used if the channel has to be created on the fly. */
  channelName?: string;
  /** Logical template: "task" | "alert" | "digest". */
  template: string;
  priority?: Priority;
  /** Idempotency key. A retried call with the same key sends nothing. */
  dedupeKey?: string;
  /** Logical field -> value. Mapped and truncated per the template. */
  data: Record<string, string | number | Date | null | undefined>;
  /**
   * Where tapping the message goes. `url` opens the caller's own page
   * in a web view; `path` is a mini program path for the rare screen
   * the hub's own app implements. Callers never write the WeChat
   * `page` parameter themselves -- it has to point inside the mini
   * program, and making every system learn that is how you end up with
   * three systems hard-coding the same wrong path.
   */
  link?: { url?: string; path?: string } | null;
  /** Days the detail payload stays resolvable. Default 30. */
  expiresInDays?: number;
};

export type DeliveryOutcome = {
  openId: string;
  deliveryId: string | null;
  status: "sent" | "no_quota" | "muted" | "failed" | "duplicate";
  errcode?: string;
};

export type NotifyOutcome =
  | { ok: false; error: string }
  | { ok: true; channelId: string; deliveries: DeliveryOutcome[] };

/** Where a tapped message lands. One screen, every app, every template. */
const DETAIL_PAGE = "pages/message/index";

const MAX_PAYLOAD_FIELDS = 12;
const MAX_PAYLOAD_VALUE = 200;

/**
 * The stored payload: enough to render the detail screen, not enough
 * to be a message store.
 *
 * The cap is structural rather than advisory. The wash bay sits on a
 * private network and cannot be called back for the full record, so
 * something has to be kept -- but the moment a caller can stash
 * arbitrary blobs here, the hub has quietly become everyone's
 * database, with everyone's retention problem.
 */
function buildPayload(input: {
  data: NotifyInput["data"];
  appName: string;
  channelName: string;
  link?: NotifyInput["link"];
}) {
  const fields: Record<string, string> = {};
  let count = 0;
  for (const [key, value] of Object.entries(input.data)) {
    if (value === null || value === undefined || value === "") continue;
    if (count >= MAX_PAYLOAD_FIELDS) break;
    const text = value instanceof Date ? value.toISOString() : String(value);
    fields[key] = text.slice(0, MAX_PAYLOAD_VALUE);
    count += 1;
  }

  return JSON.stringify({
    source: input.appName,
    channel: input.channelName,
    fields,
    link: input.link ?? null,
  });
}

function parseFieldMap(raw: string): Record<string, string> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const map: Record<string, string> = {};
    for (const [logical, field] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof field === "string" && field) map[logical] = field;
    }
    return map;
  } catch {
    return {};
  }
}

export async function notify(
  app: NotifyAppContext,
  input: NotifyInput,
): Promise<NotifyOutcome> {
  const template = await prisma.notifyTemplate.findUnique({
    where: { miniProgramId_key: { miniProgramId: app.miniProgramId, key: input.template } },
  });
  if (!template || !template.isActive) {
    return { ok: false, error: "TEMPLATE_NOT_FOUND" };
  }

  const channel = input.channelName
    ? await ensureChannel({ appId: app.appId, key: input.channel, name: input.channelName })
    : await prisma.notifyChannel.findUnique({
        where: { appId_key: { appId: app.appId, key: input.channel } },
      });
  if (!channel || !channel.isActive) {
    return { ok: false, error: "CHANNEL_NOT_FOUND" };
  }

  // Deduplication is checked before any work and enforced again by a
  // unique index below, because the common case for a repeat is two
  // retries arriving at two instances at the same moment.
  if (input.dedupeKey) {
    const existing = await prisma.notifyDelivery.findMany({
      where: { appId: app.appId, dedupeKey: input.dedupeKey },
    });
    if (existing.length > 0) {
      return {
        ok: true,
        channelId: channel.id,
        deliveries: existing.map((delivery) => ({
          openId: delivery.openId,
          deliveryId: delivery.id,
          status: "duplicate" as const,
        })),
      };
    }
  }

  const subscriptions = await prisma.notifySubscription.findMany({
    where: { channelId: channel.id },
  });
  if (subscriptions.length === 0) {
    return { ok: true, channelId: channel.id, deliveries: [] };
  }

  const credentials = await getMiniProgramCredentials(app.miniProgramId);
  const fieldMap = parseFieldMap(template.fieldMap);
  const priority: Priority = input.priority ?? "normal";
  const payload = buildPayload({
    data: input.data,
    appName: app.appName,
    channelName: channel.name,
    link: input.link,
  });
  const expiresAt = new Date(
    Date.now() + Math.max(1, input.expiresInDays ?? 30) * 24 * 60 * 60 * 1000,
  );
  const now = new Date();

  const deliveries: DeliveryOutcome[] = [];

  for (const subscription of subscriptions) {
    if (subscription.mutedUntil && subscription.mutedUntil > now) {
      deliveries.push({ openId: subscription.openId, deliveryId: null, status: "muted" });
      continue;
    }

    let delivery;
    try {
      delivery = await prisma.notifyDelivery.create({
        data: {
          appId: app.appId,
          channelId: channel.id,
          openId: subscription.openId,
          templateKey: template.key,
          dedupeKey: input.dedupeKey ?? null,
          priority,
          payload,
          page: input.link ? JSON.stringify(input.link) : null,
          status: "queued",
          expiresAt,
        },
      });
    } catch {
      // The unique index on (appId, dedupeKey, openId) fired: another
      // request won the race for this exact message.
      deliveries.push({ openId: subscription.openId, deliveryId: null, status: "duplicate" });
      continue;
    }

    // Spend before sending. A slot spent on a send that then fails is
    // refunded below; a slot read before sending and decremented after
    // would let two concurrent updates both see "one left".
    const spent = await spendQuota({
      miniProgramId: app.miniProgramId,
      openId: subscription.openId,
      templateKey: template.key,
      priority,
    });

    if (!spent) {
      await prisma.notifyDelivery.update({
        where: { id: delivery.id },
        data: { status: "no_quota" },
      });
      deliveries.push({ openId: subscription.openId, deliveryId: delivery.id, status: "no_quota" });
      continue;
    }

    const data: Record<string, { value: string }> = {};
    for (const [logical, field] of Object.entries(fieldMap)) {
      const value = input.data[logical];
      if (value === null || value === undefined || value === "") continue;
      data[field] = { value: formatFieldValue(field, value) };
    }

    const result = await sendSubscribeMessage({
      credentials,
      openId: subscription.openId,
      templateId: template.templateId,
      page: `${DETAIL_PAGE}?d=${delivery.id}`,
      data,
    });

    if (result.ok) {
      await prisma.notifyDelivery.update({
        where: { id: delivery.id },
        data: { status: "sent", sentAt: new Date() },
      });
      deliveries.push({ openId: subscription.openId, deliveryId: delivery.id, status: "sent" });
      continue;
    }

    if (result.quotaExhausted) {
      // WeChat's count is the real one. Ours was optimistic -- a grant
      // we recorded has since expired, or was never really there.
      await clearQuota({
        miniProgramId: app.miniProgramId,
        openId: subscription.openId,
        templateKey: template.key,
      });
      await prisma.notifyDelivery.update({
        where: { id: delivery.id },
        data: { status: "no_quota", errcode: result.errcode },
      });
      deliveries.push({
        openId: subscription.openId,
        deliveryId: delivery.id,
        status: "no_quota",
        errcode: result.errcode,
      });
      continue;
    }

    // Any other failure means WeChat did not accept the message, and a
    // message it did not accept did not consume an authorisation.
    await refundQuota({
      miniProgramId: app.miniProgramId,
      openId: subscription.openId,
      templateKey: template.key,
    });
    await prisma.notifyDelivery.update({
      where: { id: delivery.id },
      data: { status: "failed", errcode: result.errcode },
    });
    deliveries.push({
      openId: subscription.openId,
      deliveryId: delivery.id,
      status: "failed",
      errcode: result.errcode,
    });
  }

  return { ok: true, channelId: channel.id, deliveries };
}

/**
 * Delete what has aged out.
 *
 * The hub promises callers that it is a channel, not an archive. This
 * is where that promise is kept, and it is why `expiresAt` is a column
 * rather than a convention.
 */
export async function purgeExpiredDeliveries(now = new Date()) {
  const { count } = await prisma.notifyDelivery.deleteMany({
    where: { expiresAt: { lt: now } },
  });
  return count;
}
