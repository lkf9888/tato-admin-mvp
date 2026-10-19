import { NextResponse } from "next/server";

import { requireCurrentAdminContext } from "@/lib/auth";
import { loadGuestMessagesPage } from "@/lib/guest-messages-data";

export const runtime = "nodejs";

/** Emails per older page: small, so each "load older" stays quick. */
const OLDER_PAGE_EMAILS = 200;

/**
 * Older guest conversations, one page per call, after `cursor` (the
 * last email id of the page before). The messages page asks for these
 * only when the operator wants to go further back than the first page.
 * Under /api/messages, so the messages section's access rule applies.
 */
export async function GET(request: Request) {
  let context;
  try {
    context = await requireCurrentAdminContext();
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const cursor = new URL(request.url).searchParams.get("cursor")?.trim();
  if (!cursor) return NextResponse.json({ error: "CURSOR_REQUIRED" }, { status: 400 });

  const page = await loadGuestMessagesPage(context.workspace.id, { cursor, take: OLDER_PAGE_EMAILS });
  return NextResponse.json(page, { headers: { "Cache-Control": "no-store" } });
}
