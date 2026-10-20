import { NextResponse } from "next/server";

import { requireCurrentAdminContext } from "@/lib/auth";
import { censusMailbox, GmailInboxError } from "@/lib/gmail-inbox";

export const runtime = "nodejs";

/**
 * Read-only survey of the Turo mail still in the inbox, grouped by kind
 * and subject shape (see censusMailbox). Admin session only.
 */
export async function GET() {
  let context;
  try {
    context = await requireCurrentAdminContext();
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  try {
    return NextResponse.json(await censusMailbox(context.workspace.id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof GmailInboxError) return NextResponse.json({ error: error.code }, { status: error.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "FAILED" }, { status: 500 });
  }
}
