import { NextRequest, NextResponse } from "next/server";

import { requireCurrentAdminContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const { workspace } = await requireCurrentAdminContext();

  const presets = await prisma.contractTextPreset.findMany({
    where: { workspaceId: workspace.id },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ presets });
}

export async function POST(req: NextRequest) {
  const { workspace } = await requireCurrentAdminContext();
  const body = await req.json().catch(() => null);
  const value = clean(body?.value);
  const label = clean(body?.label) || value?.slice(0, 60);
  if (!label || !value) {
    return NextResponse.json({ error: "Preset label and text are required." }, { status: 400 });
  }

  const preset = await prisma.contractTextPreset.create({
    data: {
      workspaceId: workspace.id,
      label,
      value,
    },
  });

  return NextResponse.json({ preset });
}

export async function DELETE(req: NextRequest) {
  const { workspace } = await requireCurrentAdminContext();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Preset id is required." }, { status: 400 });

  await prisma.contractTextPreset.deleteMany({
    where: { id, workspaceId: workspace.id },
  });

  return NextResponse.json({ ok: true });
}

function clean(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
