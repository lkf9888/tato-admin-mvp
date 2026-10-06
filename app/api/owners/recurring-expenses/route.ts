import { NextResponse } from "next/server";

import { hasScheduledRunSecret } from "@/lib/cron-auth";
import { materializeRecurringExpenses } from "@/lib/owner-ledger-recurring";

export const runtime = "nodejs";

/**
 * Called daily by `.github/workflows/owner-recurring-expenses.yml`: write
 * every recurring owner charge that has come due. Opening an owner's
 * ledger does the same for that owner, so this is for the ones nobody
 * looked at today -- and for the owner's share link, which is read too.
 */
export async function POST(request: Request) {
  if (!hasScheduledRunSecret(request)) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const written = await materializeRecurringExpenses();
  return NextResponse.json({ ok: true, written });
}
