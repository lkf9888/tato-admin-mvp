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
    const result = await runGmailSync({ workspaceId: context.workspaceId });

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
    console.log(`[gmail-sync] ${summarizeGmailSyncResult(result)}`);
    return NextResponse.json(result);
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
