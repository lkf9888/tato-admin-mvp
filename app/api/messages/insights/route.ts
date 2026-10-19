import { NextResponse } from "next/server";

import { requireCurrentAdminContext } from "@/lib/auth";
import { intentReport, runCoverageCheck, runIntentClassification } from "@/lib/message-insights";

export const runtime = "nodejs";

/**
 * What guests ask about, measured from the message history (see
 * lib/message-insights). GET reads the report; POST runs a step:
 * `{"step":"classify"}` until `remaining` is 0, then `{"step":"coverage"}`.
 * Admin session only -- it spends model time.
 */
export async function GET() {
  let context;
  try {
    context = await requireCurrentAdminContext();
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const report = await intentReport(context.workspace.id);
  return NextResponse.json(report ?? { error: "NOT_STARTED" }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  let context;
  try {
    context = await requireCurrentAdminContext();
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as { step?: string } | null;
  try {
    if (body?.step === "classify") return NextResponse.json(await runIntentClassification(context.workspace.id));
    if (body?.step === "coverage") return NextResponse.json(await runCoverageCheck(context.workspace.id));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "FAILED" }, { status: 400 });
  }
  return NextResponse.json({ error: "BAD_STEP" }, { status: 400 });
}
