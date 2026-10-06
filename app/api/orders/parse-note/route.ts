import { NextResponse } from "next/server";
import { z } from "zod";

import { requireCurrentAdminContext } from "@/lib/auth";
import { isKimiConfigured } from "@/lib/kimi";
import { parseOrderNote } from "@/lib/order-note-parser";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const bodySchema = z.object({ text: z.string().trim().min(5).max(4000) });

/**
 * Read a pasted WeChat or SMS message into offline-order fields. Nothing
 * is saved: the answer only fills the form for a person to check.
 */
export async function POST(request: Request) {
  const { workspace } = await requireCurrentAdminContext();
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });
  if (!isKimiConfigured()) return NextResponse.json({ error: "AI_NOT_CONFIGURED" }, { status: 400 });

  const fleet = await prisma.vehicle.findMany({
    where: { workspaceId: workspace.id, isArchived: false },
    select: { id: true, plateNumber: true, brand: true, model: true, year: true, nickname: true },
  });
  const result = await parseOrderNote(parsed.data.text, fleet);
  if (!result.ok) return NextResponse.json({ error: "PARSE_FAILED", detail: result.reason }, { status: 502 });
  return NextResponse.json(result);
}
