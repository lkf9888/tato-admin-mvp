import { NextResponse } from "next/server";
import { z } from "zod";

import { requireCurrentAdminContext } from "@/lib/auth";
import { AD_PLATFORMS, buildAdDraft } from "@/lib/site-ad-copy";
import { loadAdFacts, polishAdDraft } from "@/lib/site-ad-copy-server";

export const runtime = "nodejs";

const bodySchema = z.object({ vehicleId: z.string().min(1), platform: z.enum(AD_PLATFORMS) });

/** An AI rewrite of one car's ad for one platform, checked against the facts. */
export async function POST(request: Request) {
  const { workspace } = await requireCurrentAdminContext();
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });
  const facts = await loadAdFacts(workspace.id, parsed.data.vehicleId);
  if (!facts) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const draft = buildAdDraft(parsed.data.platform, facts);
  return NextResponse.json(await polishAdDraft(draft));
}
