import { randomBytes } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { requireCurrentAdminContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/** List and mint calendar subscription URLs. */

const bodySchema = z.object({
  /** Null or absent means the whole fleet. */
  vehicleId: z.string().min(1).nullable().optional(),
  label: z.string().trim().max(120).optional().default(""),
});

export async function GET() {
  const { workspace } = await requireCurrentAdminContext();

  const feeds = await prisma.calendarFeed.findMany({
    where: { workspaceId: workspace.id, isActive: true },
    include: { vehicle: { select: { plateNumber: true, nickname: true } } },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    feeds: feeds.map((feed) => ({
      id: feed.id,
      token: feed.token,
      vehicleId: feed.vehicleId,
      vehicleLabel: feed.vehicle
        ? feed.vehicle.plateNumber || feed.vehicle.nickname
        : null,
      label: feed.label ?? "",
      lastReadAt: feed.lastReadAt?.toISOString() ?? null,
      createdAt: feed.createdAt.toISOString(),
    })),
  });
}

export async function POST(request: Request) {
  const { workspace, user } = await requireCurrentAdminContext();

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });
  }

  const vehicleId = parsed.data.vehicleId ?? null;
  if (vehicleId) {
    const vehicle = await prisma.vehicle.findFirst({
      where: { id: vehicleId, workspaceId: workspace.id },
      select: { id: true },
    });
    if (!vehicle) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }
  }

  // Reuse rather than rotate. Minting a second feed for the same
  // scope would leave the first one live and unlabelled, and the
  // operator with two URLs and no way to tell which one they gave
  // the owner.
  const existing = await prisma.calendarFeed.findFirst({
    where: { workspaceId: workspace.id, vehicleId, isActive: true },
    select: { id: true, token: true },
  });
  if (existing) {
    return NextResponse.json({ id: existing.id, token: existing.token, reused: true });
  }

  const feed = await prisma.calendarFeed.create({
    data: {
      workspaceId: workspace.id,
      vehicleId,
      token: randomBytes(24).toString("base64url"),
      label: parsed.data.label || null,
      createdBy: user.name,
    },
    select: { id: true, token: true },
  });

  return NextResponse.json({ id: feed.id, token: feed.token, reused: false });
}
