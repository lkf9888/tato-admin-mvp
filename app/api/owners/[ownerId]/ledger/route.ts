import { NextRequest, NextResponse } from "next/server";
import { OwnerLedgerKind } from "@prisma/client";
import { revalidatePath } from "next/cache";

import { getCurrentAdminUser } from "@/lib/auth";
import { logActivity } from "@/lib/orders";
import { prisma } from "@/lib/prisma";

const MANUAL_KINDS = new Set<OwnerLedgerKind>([
  OwnerLedgerKind.EXPENSE_REIMBURSEMENT,
  OwnerLedgerKind.MANUAL_ADJUSTMENT,
  OwnerLedgerKind.SETTLEMENT_PAYMENT,
]);

type Params = Promise<{ ownerId: string }>;

async function requireOwner(ownerId: string) {
  const user = await getCurrentAdminUser();
  if (!user?.workspaceId) return { error: "Unauthorized" as const, status: 401 as const };

  const owner = await prisma.owner.findFirst({
    where: { id: ownerId, workspaceId: user.workspaceId },
  });
  if (!owner) return { error: "Owner not found" as const, status: 404 as const };

  return { user, owner, workspaceId: user.workspaceId };
}

export async function POST(request: NextRequest, { params }: { params: Params }) {
  const { ownerId } = await params;
  const context = await requireOwner(ownerId);
  if ("error" in context) {
    return NextResponse.json({ error: context.error }, { status: context.status });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const kind = String(body.kind || "") as OwnerLedgerKind;
  if (!MANUAL_KINDS.has(kind)) {
    return NextResponse.json({ error: "Invalid ledger kind" }, { status: 400 });
  }

  const amount = Number(body.amount);
  if (!Number.isFinite(amount)) {
    return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
  }

  const occurredAt = body.occurredAt ? new Date(String(body.occurredAt)) : new Date();
  if (Number.isNaN(occurredAt.getTime())) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }

  let vehicleId: string | null = null;
  if (body.vehicleId) {
    const vehicle = await prisma.vehicle.findFirst({
      where: {
        id: String(body.vehicleId),
        workspaceId: context.workspaceId,
        ownerId: context.owner.id,
      },
      select: { id: true },
    });
    if (!vehicle) {
      return NextResponse.json({ error: "Vehicle not found for this owner" }, { status: 400 });
    }
    vehicleId = vehicle.id;
  }

  const item = await prisma.ownerLedgerItem.create({
    data: {
      workspaceId: context.workspaceId,
      ownerId: context.owner.id,
      vehicleId,
      kind,
      amount: +amount.toFixed(2),
      occurredAt,
      note: typeof body.note === "string" && body.note.trim() ? body.note.trim() : null,
      isAuto: false,
    },
  });

  await logActivity({
    workspaceId: context.workspaceId,
    actor: context.user.name,
    action: "owner_ledger_item_created",
    entityType: "OwnerLedgerItem",
    entityId: item.id,
    metadata: { ownerId: context.owner.id, kind, amount: item.amount },
  });

  revalidatePath("/owners");
  revalidatePath("/owner-statements");
  return NextResponse.json({ item });
}
