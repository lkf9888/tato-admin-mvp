import { NextResponse } from "next/server";

import { hasScheduledRunSecret } from "@/lib/cron-auth";
import { reconcileAllOrderTasks } from "@/lib/staff-order-tasks";

export const runtime = "nodejs";

/**
 * Called every 15 minutes by `.github/workflows/staff-order-tasks.yml`.
 *
 * Orders reach TATO by paths that do not run the order-task sync
 * themselves -- the CSV import, booking mail, the rental site -- so this
 * is what turns their returns into tasks and moves or cancels the tasks
 * of trips that changed.
 */
export async function POST(request: Request) {
  if (!hasScheduledRunSecret(request)) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const result = await reconcileAllOrderTasks({ origin: new URL(request.url).origin });
  return NextResponse.json({ ok: true, ...result });
}
