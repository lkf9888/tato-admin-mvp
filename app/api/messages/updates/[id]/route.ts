import { NextResponse } from "next/server";

import { requireCurrentAdminContext } from "@/lib/auth";
import { loadTuroUpdateDetail } from "@/lib/turo-updates-data";

export const runtime = "nodejs";

/** One update opened: the mail in full, its facts and its trip's other mail. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  let context;
  try {
    context = await requireCurrentAdminContext();
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const { id } = await params;
  const detail = await loadTuroUpdateDetail(context.workspace.id, id);
  if (!detail) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  return NextResponse.json(detail, { headers: { "Cache-Control": "no-store" } });
}
