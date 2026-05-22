import { NextResponse } from "next/server";

import { getCurrentAdminUser } from "@/lib/auth";
import {
  resolveTuroSyncWorkspace,
  runTuroCsvSync,
  TuroSyncError,
} from "@/lib/turo-sync";

export const runtime = "nodejs";

function hasValidSyncSecret(request: Request) {
  const secret = process.env.TURO_SYNC_SECRET?.trim();
  if (!secret) return false;

  const bearer = request.headers.get("authorization")?.trim();
  const headerSecret = request.headers.get("x-tato-sync-secret")?.trim();
  return bearer === `Bearer ${secret}` || headerSecret === secret;
}

async function getSyncContext(request: Request) {
  const user = await getCurrentAdminUser();
  if (user?.workspaceId && user.workspace) {
    return {
      workspaceId: user.workspaceId,
      actor: user.name,
      billingBypassActive: user.isBillingExempt,
    };
  }

  if (hasValidSyncSecret(request)) {
    const workspace = await resolveTuroSyncWorkspace();
    return {
      workspaceId: workspace.id,
      actor: process.env.TURO_SYNC_ACTOR?.trim() || "Turo auto sync",
      billingBypassActive: false,
    };
  }

  return null;
}

export async function POST(request: Request) {
  const context = await getSyncContext(request);
  if (!context) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runTuroCsvSync(context);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof TuroSyncError) {
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          details: error.details,
        },
        { status: error.status },
      );
    }

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Turo sync failed",
        code: "TURO_SYNC_FAILED",
      },
      { status: 500 },
    );
  }
}
