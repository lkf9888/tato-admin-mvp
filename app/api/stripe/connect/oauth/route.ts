import { timingSafeEqual } from "node:crypto";
import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";

import { requireCurrentAdminContext } from "@/lib/auth";
import { logActivity } from "@/lib/orders";
import {
  completeConnectOAuth,
  CONNECT_OAUTH_COOKIE,
  ConnectOAuthError,
} from "@/lib/stripe-connect";

export const runtime = "nodejs";

function sameState(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Where Stripe sends the host back after they approve (or decline)
 * linking their existing account. Only the browser that started the
 * link, signed in to the same workspace, can finish it.
 */
export async function GET(request: NextRequest) {
  const { workspace, user } = await requireCurrentAdminContext();
  const back = (query: string) => {
    const response = NextResponse.redirect(new URL(`/payouts?${query}`, request.url));
    response.cookies.delete(CONNECT_OAUTH_COOKIE);
    return response;
  };

  const params = request.nextUrl.searchParams;
  const [expectedState, expectedWorkspace] = (
    request.cookies.get(CONNECT_OAUTH_COOKIE)?.value ?? ""
  ).split(".");
  const state = params.get("state") ?? "";
  if (!expectedState || !sameState(state, expectedState) || expectedWorkspace !== workspace.id) {
    return back("connect=invalid_state");
  }

  // The host pressed "cancel" on Stripe's page.
  if (params.get("error")) return back("connect=denied");

  const code = params.get("code");
  if (!code) return back("connect=failed");

  try {
    const snapshot = await completeConnectOAuth({ workspaceId: workspace.id, code });
    await logActivity({
      workspaceId: workspace.id,
      actor: user.name,
      action: "stripe_connect_existing_linked",
      entityType: "WorkspaceBilling",
      entityId: workspace.id,
      metadata: { accountId: snapshot?.accountId ?? null },
    });
    revalidatePath("/payouts");
    return back("connected=1");
  } catch (error) {
    const reason =
      error instanceof ConnectOAuthError ? error.code.toLowerCase() : "failed";
    return back(`connect=${reason}`);
  }
}
