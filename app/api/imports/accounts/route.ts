import { NextResponse } from "next/server";
import { z } from "zod";

import { requireCurrentAdminContext } from "@/lib/auth";
import { ACCOUNT_LABEL_MAX, saveAccountLabel } from "@/lib/turo-account-labels";

export const runtime = "nodejs";

const schema = z.object({
  /** The account key as on the cars; "" for the main account. */
  account: z.string().max(80),
  /** The name to show; empty clears it back to the key. */
  label: z.string().max(ACCOUNT_LABEL_MAX * 2),
});

/** Name a Turo account (display only; see lib/turo-account-labels). */
export async function PUT(request: Request) {
  let context;
  try {
    context = await requireCurrentAdminContext();
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });
  const labels = await saveAccountLabel(context.workspace.id, parsed.data.account, parsed.data.label);
  return NextResponse.json({ labels });
}
