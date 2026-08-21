import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";

import { getCurrentAdminUser } from "@/lib/auth";
import {
  GmailInboxError,
  isGmailInboxConfigured,
  runGmailSync,
  summarizeGmailSyncResult,
} from "@/lib/gmail-inbox";
import { logActivity } from "@/lib/orders";
import { resolveTuroSyncWorkspace } from "@/lib/turo-sync";

export const runtime = "nodejs";

/**
 * Constant-time secret comparison. The previous `/api/turo-sync`
 * implementation uses `===`, which leaks the secret one byte at a time
 * to an attacker who can measure response timing; don't repeat it here.
 */
function hasValidSyncSecret(request: Request) {
  const secret = process.env.GMAIL_SYNC_SECRET?.trim();
  if (!secret) return false;

  const bearer = request.headers.get("authorization")?.trim() ?? "";
  const headerSecret = request.headers.get("x-tato-sync-secret")?.trim() ?? "";
  const candidates = [bearer.replace(/^Bearer\s+/i, ""), headerSecret];

  const expected = Buffer.from(secret, "utf8");
  return candidates.some((candidate) => {
    const supplied = Buffer.from(candidate, "utf8");
    if (supplied.length !== expected.length) return false;
    return timingSafeEqual(supplied, expected);
  });
}

/**
 * Resolve who this sync runs for. An admin session syncs their own
 * workspace; a scheduler presenting GMAIL_SYNC_SECRET syncs the
 * workspace named by TURO_SYNC_WORKSPACE_SLUG.
 */
async function getSyncContext(request: Request) {
  const user = await getCurrentAdminUser();
  if (user?.workspaceId && user.workspace) {
    return { workspaceId: user.workspaceId, actor: user.name };
  }

  if (hasValidSyncSecret(request)) {
    const workspace = await resolveTuroSyncWorkspace();
    return {
      workspaceId: workspace.id,
      actor: process.env.GMAIL_SYNC_ACTOR?.trim() || "Gmail auto sync",
    };
  }

  return null;
}

export async function POST(request: Request) {
  const context = await getSyncContext(request);
  if (!context) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isGmailInboxConfigured()) {
    return NextResponse.json(
      {
        error:
          "Gmail inbox is not configured. Set GMAIL_IMAP_USER and GMAIL_IMAP_PASSWORD (a Gmail App Password).",
        code: "GMAIL_NOT_CONFIGURED",
      },
      { status: 503 },
    );
  }

  try {
    // `?days=` is the historical backfill switch, admin-session only:
    // a scheduler holding the shared secret must not be able to turn
    // a fifteen-minute job into a ten-year mailbox scan.
    const requestedDays = Number.parseInt(
      new URL(request.url).searchParams.get("days") ?? "",
      10,
    );
    const lookbackDays =
      context.actor && Number.isFinite(requestedDays) && requestedDays > 0
        ? Math.min(requestedDays, 3650)
        : undefined;

    const requestedMax = Number.parseInt(
      new URL(request.url).searchParams.get("max") ?? "",
      10,
    );
    const maxMessages =
      context.actor && Number.isFinite(requestedMax) && requestedMax > 0
        ? Math.min(requestedMax, 2000)
        : undefined;

    // `?mode=ingest` reads the mailbox and stops; `?mode=enrich` runs
    // only the model passes. Unrecognised or absent means both, so the
    // scheduled job that has been calling this all along is unchanged.
    const requestedMode = new URL(request.url).searchParams.get("mode");
    const mode =
      requestedMode === "ingest" || requestedMode === "enrich" ? requestedMode : undefined;

    const result = await runGmailSync({
      workspaceId: context.workspaceId,
      lookbackDays,
      maxMessages,
      mode,
    });

    // Turning mail into bookings now happens inside `runGmailSync`,
    // between ingestion and re-attribution, because a guest message is
    // matched to its trip at ingest and therefore needs the order to
    // already exist. Doing it out here meant a booking and a message
    // arriving together could not resolve in the same run -- and the
    // IMAP push path, which never called this route at all, created no
    // orders whatsoever.
    const orders = result.orders;

    // Only log when something actually happened. A poll that finds
    // nothing new is the common case and would otherwise bury the
    // activity log — which already has no retention policy.
    if (result.imported > 0) {
      await logActivity({
        workspaceId: context.workspaceId,
        actor: context.actor,
        action: "gmail_inbox_synced",
        entityType: "Workspace",
        entityId: context.workspaceId,
        metadata: result,
      });
    }

    // eslint-disable-next-line no-console
    console.log(
      `[gmail-sync] ${summarizeGmailSyncResult(result)} ordersCreated=${orders?.created ?? 0} ordersUpdated=${orders?.updated ?? 0} skippedCompleted=${orders?.skippedCompleted ?? 0} ambiguousVehicle=${orders?.ambiguousVehicle.length ?? 0}`,
    );
    return NextResponse.json({ ...result, orders });
  } catch (error) {
    if (error instanceof GmailInboxError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }

    // eslint-disable-next-line no-console
    console.error(
      `[gmail-sync] failed :: ${error instanceof Error ? error.message : String(error)}`,
    );
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Gmail sync failed",
        code: "GMAIL_SYNC_FAILED",
      },
      { status: 500 },
    );
  }
}
