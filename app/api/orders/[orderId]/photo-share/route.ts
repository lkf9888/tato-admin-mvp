import { randomBytes } from "node:crypto";

import { NextResponse } from "next/server";

import { requireCurrentAdminContext } from "@/lib/auth";
import { logActivity } from "@/lib/orders";
import { prisma } from "@/lib/prisma";

type Params = Promise<{ orderId: string }>;

/**
 * One link for every photo of this trip. Asking again returns the same
 * link rather than a new one, so a link sent five minutes ago keeps
 * working.
 */
export async function POST(_request: Request, { params }: { params: Params }) {
  const { orderId } = await params;
  const { workspace, user } = await requireCurrentAdminContext();
  const order = await prisma.order.findFirst({
    where: { id: orderId, workspaceId: workspace.id, isArchived: false },
    select: { id: true },
  });
  if (!order) return NextResponse.json({ error: "ORDER_NOT_FOUND" }, { status: 404 });

  const existing = await prisma.orderPhotoShare.findUnique({ where: { orderId: order.id } });
  if (existing) return NextResponse.json({ token: existing.token });

  const share = await prisma.orderPhotoShare.create({
    data: {
      workspaceId: workspace.id,
      orderId: order.id,
      token: randomBytes(32).toString("base64url"),
      createdBy: user.name,
    },
  });
  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: "order_photos_shared",
    entityType: "Order",
    entityId: order.id,
  });
  return NextResponse.json({ token: share.token });
}

/** Revoke: every copy of the link stops working at once. */
export async function DELETE(_request: Request, { params }: { params: Params }) {
  const { orderId } = await params;
  const { workspace, user } = await requireCurrentAdminContext();
  const removed = await prisma.orderPhotoShare.deleteMany({ where: { orderId, workspaceId: workspace.id } });
  if (removed.count > 0) {
    await logActivity({
      workspaceId: workspace.id,
      actor: user.name,
      action: "order_photos_share_revoked",
      entityType: "Order",
      entityId: orderId,
    });
  }
  return NextResponse.json({ ok: true });
}

/** Whether this trip's photos are shared, and the link if they are. */
export async function GET(_request: Request, { params }: { params: Params }) {
  const { orderId } = await params;
  const { workspace } = await requireCurrentAdminContext();
  const share = await prisma.orderPhotoShare.findFirst({ where: { orderId, workspaceId: workspace.id } });
  return NextResponse.json({ token: share?.token ?? null });
}
