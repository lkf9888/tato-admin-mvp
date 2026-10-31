import "server-only";

import { ALL_CATEGORIES, parseCategories, type NotificationCategory } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import { getAppUrl } from "@/lib/stripe";

/**
 * TATO's notifications in WeChat, through PushPlus (pushplus.plus).
 *
 * WeChat mini-program subscribe messages are one authorisation per send,
 * so they run dry on a busy day. PushPlus delivers through its own
 * service account instead, with no per-message authorisation, and a
 * group ("一对多" topic) reaches the operator and every staff member who
 * scanned in -- they need no account of their own.
 *
 * Every category notification (lib/web-push `notifyCategory`) is also
 * queued here when the workspace has WeChat on and the category ticked.
 * Written to an outbox first and sent after, so PushPlus being down or
 * rate-limiting delays a notification instead of losing it, and nothing
 * here can fail the business step that raised it.
 *
 * What goes out is a summary -- car, dates, amounts, a link back into
 * TATO. Messages pass through PushPlus's servers in mainland China, so
 * phone numbers and email addresses are stripped from the text, and
 * nothing that carries a licence or ID is ever passed in.
 *
 * Each workspace brings its own PushPlus account: the message token and
 * the group code are entered on its settings page and stored with it,
 * so one operator's quota and group never carry another's messages.
 */

const ENDPOINT = "https://www.pushplus.plus/send";
/** PushPlus allows five requests per ten seconds; stay under it. */
const SEND_GAP_MS = 2_500;
/** One flush sends at most this many, so a backlog drains over runs. */
const FLUSH_MAX = 12;
const MAX_ATTEMPTS = 6;
/** Older than this, a notification is not news any more. */
const MAX_AGE_MS = 24 * 3_600_000;
/** The same text again within this window is dropped: PushPlus refuses
 *  identical content more than three times an hour, and counts the
 *  refusal against the daily quota. */
const DEDUPE_WINDOW_MS = 60 * 60_000;

export async function getPushPlusSetting(workspaceId: string) {
  const row = await prisma.pushPlusSetting.findUnique({ where: { workspaceId } });
  return {
    enabled: row?.enabled ?? false,
    categories: parseCategories(row?.categories),
    token: row?.token ?? null,
    topic: row?.topic ?? null,
    lastSentAt: row?.lastSentAt ?? null,
    lastError: row?.lastError ?? null,
  };
}

export async function savePushPlusSetting(
  workspaceId: string,
  input: { enabled?: boolean; categories?: NotificationCategory[]; token?: string; topic?: string },
) {
  const categories = input.categories
    ? (() => {
        const unique = [...new Set(input.categories)];
        return ALL_CATEGORIES.every((category) => unique.includes(category)) ? null : JSON.stringify(unique);
      })()
    : undefined;
  await prisma.pushPlusSetting.upsert({
    where: { workspaceId },
    create: {
      workspaceId,
      enabled: input.enabled ?? false,
      categories: categories ?? null,
      token: input.token?.trim() || null,
      topic: input.topic?.trim() || null,
    },
    update: {
      ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
      ...(categories === undefined ? {} : { categories }),
      // An empty string clears it; absent leaves it as it was.
      ...(input.token === undefined ? {} : { token: input.token.trim() || null }),
      ...(input.topic === undefined ? {} : { topic: input.topic.trim() || null }),
    },
  });
}

/** Phone numbers and email addresses out, whatever the caller passed. */
function scrub(text: string) {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[邮箱已隐藏]")
    .replace(/\+?\(?\d[\d\s().-]{8,}\d/g, (match) => (match.replace(/\D/g, "").length >= 9 ? "[电话已隐藏]" : match));
}

function escapeHtml(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function absoluteUrl(url: string) {
  return /^https?:\/\//i.test(url) ? url : `${getAppUrl()}${url.startsWith("/") ? "" : "/"}${url}`;
}

/**
 * Queue one notification for WeChat, when the workspace takes this
 * category there. Never throws. Sending happens in the background.
 */
export async function queuePushPlus(
  workspaceId: string,
  category: NotificationCategory,
  payload: { title: string; body: string; url: string },
) {
  try {
    const setting = await getPushPlusSetting(workspaceId);
    if (!setting.token || !setting.enabled || !setting.categories.includes(category)) return;

    const title = scrub(payload.title).slice(0, 100);
    const body = scrub(payload.body).slice(0, 1_500);
    const content = `${escapeHtml(body).replace(/\n/g, "<br>")}<br><br><a href="${escapeHtml(absoluteUrl(payload.url))}">在 TATO 打开</a>`;

    const duplicate = await prisma.pushPlusMessage.findFirst({
      where: { workspaceId, title, content, createdAt: { gte: new Date(Date.now() - DEDUPE_WINDOW_MS) } },
      select: { id: true },
    });
    if (duplicate) return;

    await prisma.pushPlusMessage.create({ data: { workspaceId, category, title, content } });
    void flushPushPlus(workspaceId);
  } catch (error) {
    console.error("[pushplus] queue failed", error);
  }
}

const flushing = new Set<string>();

/**
 * Send what is due, oldest first, spaced for PushPlus's rate limit.
 * Called after queueing and by the scheduled alert scan, which is what
 * retries a failure. One flush per workspace at a time. Never throws.
 */
export async function flushPushPlus(workspaceId: string) {
  if (flushing.has(workspaceId)) return { sent: 0, failed: 0, skipped: "busy" as const };
  flushing.add(workspaceId);
  let sent = 0;
  let failed = 0;
  try {
    const { token, topic } = await getPushPlusSetting(workspaceId);
    if (!token) return { sent, failed, skipped: "not_configured" as const };

    // Too old to be worth sending: give up on them quietly.
    await prisma.pushPlusMessage.updateMany({
      where: { workspaceId, status: "pending", createdAt: { lt: new Date(Date.now() - MAX_AGE_MS) } },
      data: { status: "failed", lastError: "expired" },
    });

    const due = await prisma.pushPlusMessage.findMany({
      where: { workspaceId, status: "pending", nextAttemptAt: { lte: new Date() } },
      orderBy: { createdAt: "asc" },
      take: FLUSH_MAX,
    });
    for (const [index, message] of due.entries()) {
      if (index > 0) await new Promise((resolve) => setTimeout(resolve, SEND_GAP_MS));
      const result = await sendOne(token, topic, message.title, message.content);
      if (result.ok) {
        sent += 1;
        await prisma.pushPlusMessage.update({
          where: { id: message.id },
          data: { status: "sent", sentAt: new Date(), attempts: message.attempts + 1, lastError: null },
        });
      } else {
        failed += 1;
        const attempts = message.attempts + 1;
        await prisma.pushPlusMessage.update({
          where: { id: message.id },
          data: {
            attempts,
            lastError: result.error.slice(0, 300),
            status: attempts >= MAX_ATTEMPTS ? "failed" : "pending",
            // 2, 4, 8, 16, 32 minutes.
            nextAttemptAt: new Date(Date.now() + 2 ** attempts * 60_000),
          },
        });
      }
    }
    if (due.length > 0) {
      await prisma.pushPlusSetting.updateMany({
        where: { workspaceId },
        data: sent > 0 ? { lastSentAt: new Date(), lastError: null } : {},
      });
    }
    return { sent, failed, skipped: null };
  } catch (error) {
    console.error("[pushplus] flush failed", error);
    return { sent, failed, skipped: "error" as const };
  } finally {
    flushing.delete(workspaceId);
  }
}

async function sendOne(token: string, topic: string | null, title: string, content: string) {
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, title, content, template: "html", ...(topic ? { topic } : {}) }),
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await response.json().catch(() => null)) as { code?: number; msg?: string } | null;
    if (response.ok && data?.code === 200) return { ok: true as const };
    return { ok: false as const, error: `${data?.code ?? response.status} ${data?.msg ?? response.statusText}` };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
  }
}

/** The settings panel's test: straight to PushPlus, bypassing the outbox. */
export async function sendPushPlusTest(workspaceId: string) {
  const { token, topic } = await getPushPlusSetting(workspaceId);
  if (!token) return { ok: false as const, error: "not_configured" };
  const result = await sendOne(
    token,
    topic,
    "TATO 测试通知",
    `如果你在微信里看到这条，TATO 的微信通知已经通了。<br><br><a href="${escapeHtml(absoluteUrl("/account-settings#notifications"))}">在 TATO 打开</a>`,
  );
  await prisma.pushPlusSetting.upsert({
    where: { workspaceId },
    create: { workspaceId, ...(result.ok ? { lastSentAt: new Date() } : { lastError: result.error }) },
    update: result.ok ? { lastSentAt: new Date(), lastError: null } : { lastError: result.error.slice(0, 300) },
  });
  return result;
}

export async function getPushPlusQueueStats(workspaceId: string) {
  const [pending, failed] = await Promise.all([
    prisma.pushPlusMessage.count({ where: { workspaceId, status: "pending" } }),
    prisma.pushPlusMessage.count({
      where: { workspaceId, status: "failed", createdAt: { gte: new Date(Date.now() - MAX_AGE_MS) } },
    }),
  ]);
  return { pending, failedToday: failed };
}
