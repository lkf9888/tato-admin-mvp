import { NextResponse } from "next/server";

import { requireCurrentAdminContext } from "@/lib/auth";
import { censusMailbox, folderCensus, GmailInboxError } from "@/lib/gmail-inbox";

export const runtime = "nodejs";

/**
 * Read-only survey of the Turo mail still in the inbox, grouped by kind
 * and subject shape (see censusMailbox). Admin session only.
 */
export async function GET(request: Request) {
  let context;
  try {
    context = await requireCurrentAdminContext();
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  try {
    // `?mailbox=mailbox2` surveys the second inbox (Kevin's).
    const params = new URL(request.url).searchParams;
    const mailbox = params.get("mailbox")?.trim() || "gmail";
    // `?folders=1` reads every folder envelope by envelope instead of
    // trusting the inbox search (see folderCensus).
    if (params.get("folders")) {
      return NextResponse.json(await folderCensus(mailbox), { headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json(await censusMailbox(context.workspace.id, mailbox), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof GmailInboxError) return NextResponse.json({ error: error.code }, { status: error.status });
    return NextResponse.json({ error: error instanceof Error ? error.message : "FAILED" }, { status: 500 });
  }
}
