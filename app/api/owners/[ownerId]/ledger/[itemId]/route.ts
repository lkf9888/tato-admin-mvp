import { NextRequest, NextResponse } from "next/server";
import { OwnerLedgerKind } from "@prisma/client";
import { revalidatePath } from "next/cache";

import { getCurrentAdminUser } from "@/lib/auth";
import { logActivity } from "@/lib/orders";
import { prisma } from "@/lib/prisma";

type Params = Promise<{ ownerId: string; itemId: string }>;

async function requireItem(ownerId: string, itemId: string) {
  const user = await getCurrentAdminUser();
  if (!user?.workspaceId) return { error: "Unauthorized" as const, status: 401 as const };

  const item = await prisma.ownerLedgerItem.findFirst({
    where: {
      id: itemId,
      ownerId,
      workspaceId: user.workspaceId,
    },
    include: { owner: true },
  });
  if (!item) return { error: "Ledger item not found" as const, status: 404 as const };

  return { user, item, workspaceId: user.workspaceId };
}

export async function PATCH(request: NextRequest, { params }: { params: Params }) {
  const { ownerId, itemId } = await params;
  const context = await requireItem(ownerId, itemId);
  if ("error" in context) {
    return NextResponse.json({ error: context.error }, { status: context.status });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const data: {
    kind?: OwnerLedgerKind;
    amount?: number;
    occurredAt?: Date;
    note?: string | null;
    vehicleId?: string | null;
    isAuto: false;
  } = { isAuto: false };

  if (
    "kind" in body &&
    typeof body.kind === "string" &&
    Object.values(OwnerLedgerKind).includes(body.kind as OwnerLedgerKind)
  ) {
    data.kind = body.kind as OwnerLedgerKind;
  }

  if ("amount" in body) {
    const amount = Number(body.amount);
    if (!Number.isFinite(amount)) {
      return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
    }
    data.amount = +amount.toFixed(2);
  }

  if ("occurredAt" in body) {
    const occurredAt = new Date(String(body.occurredAt));
    if (Number.isNaN(occurredAt.getTime())) {
      return NextResponse.json({ error: "Invalid date" }, { status: 400 });
    }
    data.occurredAt = occurredAt;
  }

  if ("note" in body) {
    data.note = typeof body.note === "string" && body.note.trim() ? body.note.trim() : null;
  }

  if ("vehicleId" in body) {
    if (body.vehicleId) {
      const vehicle = await prisma.vehicle.findFirst({
        where: {
          id: String(body.vehicleId),
          workspaceId: context.workspaceId,
          ownerId: context.item.ownerId,
        },
        select: { id: true },
      });
      if (!vehicle) {
        return NextResponse.json({ error: "Vehicle not found for this owner" }, { status: 400 });
      }
      data.vehicleId = vehicle.id;
    } else {
      data.vehicleId = null;
    }
  }

  const updated = await prisma.ownerLedgerItem.update({
    where: { id: context.item.id },
    data,
  });

  await logActivity({
    workspaceId: context.workspaceId,
    actor: context.user.name,
    action: "owner_ledger_item_updated",
    entityType: "OwnerLedgerItem",
    entityId: updated.id,
    metadata: { ownerId: context.item.ownerId, kind: updated.kind, amount: updated.amount },
  });

  revalidatePath("/owner-statements");
  return NextResponse.json({ item: updated });
}

export async function DELETE(_request: NextRequest, { params }: { params: Params }) {
  const { ownerId, itemId } = await params;
  const context = await requireItem(ownerId, itemId);
  if ("error" in context) {
    return NextResponse.json({ error: context.error }, { status: context.status });
  }

  await prisma.ownerLedgerItem.delete({ where: { id: context.item.id } });

  await logActivity({
    workspaceId: context.workspaceId,
    actor: context.user.name,
    action: "owner_ledger_item_deleted",
    entityType: "OwnerLedgerItem",
    entityId: context.item.id,
    metadata: { ownerId: context.item.ownerId, kind: context.item.kind, amount: context.item.amount },
  });

  revalidatePath("/owner-statements");
  return NextResponse.json({ ok: true });
}
