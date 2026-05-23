import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { ShareVisibility } from "@prisma/client";

import { requireCurrentAdminContext } from "@/lib/auth";
import { logActivity } from "@/lib/orders";
import { prisma } from "@/lib/prisma";

type Params = Promise<{ ownerId: string }>;

function revalidateOwnerSurfaces(ownerId: string) {
  revalidatePath("/owners");
  revalidatePath("/share-links");
  revalidatePath(`/owners/${ownerId}`);
}

async function requireOwner(ownerId: string) {
  const { workspace, user } = await requireCurrentAdminContext();
  const owner = await prisma.owner.findFirst({
    where: { id: ownerId, workspaceId: workspace.id },
    select: { id: true, name: true },
  });
  if (!owner) return { error: "Owner not found" as const, status: 404 as const };
  return { workspace, user, owner };
}

export async function POST(_request: Request, { params }: { params: Params }) {
  const { ownerId } = await params;
  const context = await requireOwner(ownerId);
  if ("error" in context) {
    return NextResponse.json({ error: context.error }, { status: context.status });
  }

  const existing = await prisma.shareLink.findFirst({
    where: {
      workspaceId: context.workspace.id,
      ownerId: context.owner.id,
      isActive: true,
    },
    orderBy: { createdAt: "desc" },
  });
  if (existing) {
    return NextResponse.json({ shareToken: existing.token });
  }

  const shareLink = await prisma.shareLink.create({
    data: {
      workspaceId: context.workspace.id,
      ownerId: context.owner.id,
      token: randomBytes(18).toString("hex"),
      visibility: ShareVisibility.standard,
      createdBy: context.user.name,
    },
  });

  await logActivity({
    workspaceId: context.workspace.id,
    actor: context.user.name,
    action: "share_link_created",
    entityType: "ShareLink",
    entityId: shareLink.id,
    metadata: { ownerId: context.owner.id, visibility: shareLink.visibility },
  });

  revalidateOwnerSurfaces(context.owner.id);
  return NextResponse.json({ shareToken: shareLink.token });
}

export async function DELETE(_request: Request, { params }: { params: Params }) {
  const { ownerId } = await params;
  const context = await requireOwner(ownerId);
  if ("error" in context) {
    return NextResponse.json({ error: context.error }, { status: context.status });
  }

  const result = await prisma.shareLink.updateMany({
    where: {
      workspaceId: context.workspace.id,
      ownerId: context.owner.id,
      isActive: true,
    },
    data: { isActive: false },
  });

  await logActivity({
    workspaceId: context.workspace.id,
    actor: context.user.name,
    action: "share_link_revoked",
    entityType: "Owner",
    entityId: context.owner.id,
    metadata: { ownerId: context.owner.id, revokedCount: result.count },
  });

  revalidateOwnerSurfaces(context.owner.id);
  return NextResponse.json({ ok: true });
}
