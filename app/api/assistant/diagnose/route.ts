import { InboundEmailKind } from "@prisma/client";
import { NextResponse } from "next/server";

import { requireCurrentAdminContext } from "@/lib/auth";
import { getDiskBreakdown, getDiskUsage } from "@/lib/disk";
import { gmailIdleStatus } from "@/lib/gmail-idle";
import { prisma } from "@/lib/prisma";
import { resolveTuroSyncWorkspace } from "@/lib/turo-sync";
import { getGmailConfig, isGmailInboxConfigured } from "@/lib/gmail-inbox";
import { getChatModel, getExtractionModel, getKimiApiKey, kimiChat } from "@/lib/kimi";
import { APP_VERSION } from "@/lib/version";

export const runtime = "nodejs";

/**
 * Configuration diagnostics for the assistant and Turo inbox.
 *
 * The chat endpoint deliberately returns a generic failure to the UI,
 * which is right for normal use but useless when an operator is trying
 * to work out *why* nothing works. This route makes one minimal live
 * call to the model provider and reports exactly what came back.
 *
 * Admin-session only, and it never returns secret values — only
 * whether each is present, how long it is, and a masked prefix so the
 * operator can tell one key from another without the value leaking
 * into a screenshot or a support thread.
 */
function describeSecret(value: string) {
  if (!value) return { present: false as const };
  return {
    present: true as const,
    length: value.length,
    prefix: value.slice(0, 6),
  };
}

export async function GET() {
  let workspaceId: string | null = null;
  try {
    const context = await requireCurrentAdminContext();
    workspaceId = context.workspace.id;
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const apiKey = getKimiApiKey();
  const baseUrl = (process.env.KIMI_BASE_URL?.trim() || "https://api.moonshot.ai/v1").replace(
    /\/+$/,
    "",
  );
  const gmail = getGmailConfig();

  // Inbox attribution — the match rate the guest-messages page runs on.
  // A message with no guestName never becomes a conversation at all,
  // and one with no orderId shows without its trip. Reported here
  // because "the page is empty" and "attribution never ran" look
  // identical from outside, and because the rate is worth watching
  // after any change to the subject patterns.
  const inbox = workspaceId
    ? await (async () => {
        const guestWhere = {
          workspaceId,
          kind: { in: [InboundEmailKind.GUEST_MESSAGE, InboundEmailKind.SUPPORT] },
        };
        const [
          total,
          guestMessages,
          withGuestName,
          withVehicle,
          withOrder,
          withTuroLink,
          withSummaryZh,
          extracted,
        ] = await Promise.all([
            prisma.inboundEmail.count({ where: { workspaceId } }),
            prisma.inboundEmail.count({ where: guestWhere }),
            prisma.inboundEmail.count({ where: { ...guestWhere, guestName: { not: null } } }),
            prisma.inboundEmail.count({ where: { ...guestWhere, vehicleId: { not: null } } }),
            prisma.inboundEmail.count({ where: { ...guestWhere, orderId: { not: null } } }),
            prisma.inboundEmail.count({ where: { ...guestWhere, turoLink: { not: null } } }),
            // Across every kind, not just guest messages: the activity
            // feed shows all of them and a Chinese line is what makes
            // it skimmable.
            prisma.inboundEmail.count({ where: { workspaceId, summaryZh: { not: null } } }),
            prisma.inboundEmail.count({ where: { workspaceId, parsedAt: { not: null } } }),
          ]);
        return {
          total,
          extracted,
          withSummaryZh,
          guestMessages,
          withGuestName,
          withVehicle,
          withOrder,
          withTuroLink,
        };
      })()
    : null;

  // Which workspace the scheduled jobs actually write to, next to the
  // one the signed-in operator reads. A mismatch is invisible from
  // every screen in the app and produces exactly the symptom that
  // found it: the scheduled sync reports importing mail for hours
  // while the pages stay empty, because the rows are landing in a
  // workspace nobody opens. The alert scan resolves the same way, so
  // the digests would describe that workspace too.
  const workspaces = await (async () => {
    if (!workspaceId) return null;
    const [mine, scheduled] = await Promise.all([
      prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { id: true, slug: true, name: true },
      }),
      resolveTuroSyncWorkspace()
        .then((workspace) => ({
          id: workspace.id,
          slug: workspace.slug,
          name: workspace.name,
        }))
        .catch((error: unknown) => ({
          error: error instanceof Error ? error.message : "unresolved",
        })),
    ]);
    return {
      signedInAs: mine,
      scheduledJobsUse: scheduled,
      match: !!mine && "id" in scheduled && scheduled.id === mine.id,
      envSlug: process.env.TURO_SYNC_WORKSPACE_SLUG?.trim() || null,
    };
  })();

  const [disk, diskBreakdown] = await Promise.all([getDiskUsage(), getDiskBreakdown()]);

  const diagnostics: Record<string, unknown> = {
    // Which build answered. Without this, "the fix didn't work" and
    // "the fix isn't deployed yet" look identical from the outside.
    version: APP_VERSION,
    disk,
    diskBreakdown,
    mailWatcher: gmailIdleStatus(),
    workspaces,
    inbox,
    kimi: {
      apiKey: describeSecret(apiKey),
      baseUrl,
      chatModel: getChatModel(),
      extractionModel: getExtractionModel(),
      // Which env var name actually supplied the key, so a typo in one
      // of the two accepted names is visible.
      keySource: process.env.KIMI_API_KEY?.trim()
        ? "KIMI_API_KEY"
        : process.env.MOONSHOT_API_KEY?.trim()
          ? "MOONSHOT_API_KEY"
          : null,
    },
    gmail: {
      configured: isGmailInboxConfigured(),
      user: gmail.user ? `${gmail.user.slice(0, 3)}***@${gmail.user.split("@")[1] ?? ""}` : null,
      password: describeSecret(gmail.password),
      host: gmail.host,
      port: gmail.port,
      mailbox: gmail.mailbox,
      allowedSenders: gmail.allowedSenders,
      syncSecretConfigured: Boolean(process.env.GMAIL_SYNC_SECRET?.trim()),
    },
  };

  if (!apiKey) {
    return NextResponse.json({
      ...diagnostics,
      kimiTest: { ok: false, reason: "KIMI_API_KEY is not set in this environment." },
    });
  }

  // A small live call, but not a tiny one: the current Kimi models
  // reason before answering and those tokens count against
  // `max_tokens`, so a budget sized for the answer alone comes back
  // with empty content and no error.
  const test = await kimiChat({
    messages: [{ role: "user", content: "Reply with the single word: ok" }],
    maxTokens: 512,
    timeoutMs: 30_000,
  });

  return NextResponse.json({
    ...diagnostics,
    kimiTest: test.ok
      ? { ok: true, reply: test.content, usage: test.usage }
      : {
          ok: false,
          status: test.status,
          reason: test.reason,
          // The two failures that actually happen, with the fix, since
          // the upstream message alone rarely makes them obvious.
          hint:
            test.status === 401
              ? "Key rejected. Moonshot runs two independent regions and keys are not shared between them: platform.moonshot.cn keys only work against https://api.moonshot.cn/v1, and platform.moonshot.ai keys only against https://api.moonshot.ai/v1. Set KIMI_BASE_URL to match where the key was issued."
              : test.status === 404
                ? `Model "${getChatModel()}" was not found. The kimi-k2 series was discontinued 2026-05-25; current models are kimi-k3, kimi-k2.6 and kimi-k2.5. Override with KIMI_CHAT_MODEL.`
                : test.status === 429
                  ? "Rate limited or out of credit. Moonshot requires a balance on the account before a key will serve requests."
                  : null,
        },
  });
}
