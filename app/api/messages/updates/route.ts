import { NextResponse } from "next/server";

import { requireCurrentAdminContext } from "@/lib/auth";
import { loadTuroUpdates, UPDATE_CATEGORIES, type UpdateCategory } from "@/lib/turo-updates-data";

export const runtime = "nodejs";

/**
 * One page of the updates feed: `?category=` (a tab, or all), `?q=`
 * (guest, plate, reservation number or any word in the mail) and
 * `?before=` (the previous page's `nextBefore`). Under /api/messages, so
 * the messages section's access rule applies.
 */
export async function GET(request: Request) {
  let context;
  try {
    context = await requireCurrentAdminContext();
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const params = new URL(request.url).searchParams;
  const raw = params.get("category")?.trim() ?? "all";
  const category = (UPDATE_CATEGORIES as readonly string[]).includes(raw) ? (raw as UpdateCategory) : "all";
  const before = params.get("before")?.trim() || null;
  if (before && Number.isNaN(Date.parse(before))) {
    return NextResponse.json({ error: "INVALID_BEFORE" }, { status: 400 });
  }
  const page = await loadTuroUpdates(context.workspace.id, {
    category,
    q: params.get("q")?.slice(0, 80) ?? undefined,
    before,
  });
  return NextResponse.json(page, { headers: { "Cache-Control": "no-store" } });
}
