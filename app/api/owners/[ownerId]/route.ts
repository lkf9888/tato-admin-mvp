import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireCurrentAdminContext } from "@/lib/auth";
import { logActivity } from "@/lib/orders";
import { prisma } from "@/lib/prisma";

type Params = Promise<{ ownerId: string }>;

const ownerPatchSchema = z.object({
  name: z.string().trim().min(2),
  phone: z.string().trim().optional().or(z.literal("")),
  email: z.string().trim().email().optional().or(z.literal("")),
  companyName: z.string().trim().optional().or(z.literal("")),
  notes: z.string().trim().optional().or(z.literal("")),
});

function nullable(value?: string) {
  const clean = value?.trim();
  return clean ? clean : null;
}

function revalidateOwnerSurfaces(ownerId: string) {
  revalidatePath("/owners");
  revalidatePath("/owner-statements");
  revalidatePath(`/owners/${ownerId}`);
  revalidatePath(`/owners/${ownerId}/ledger`);
}

async function requireOwner(ownerId: string) {
  const { workspace, user } = await requireCurrentAdminContext();
  const owner = await prisma.owner.findFirst({
    where: { id: ownerId, workspaceId: workspace.id },
  });
  if (!owner) return { error: "Owner not found" as const, status: 404 as const };
  return { workspace, user, owner };
}

export async function PATCH(request: NextRequest, { params }: { params: Params }) {
  const { ownerId } = await params;
  const context = await requireOwner(ownerId);
  if ("error" in context) {
    return NextResponse.json({ error: context.error }, { status: context.status });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const parsed = ownerPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid owner" }, { status: 400 });
  }

  const owner = await prisma.owner.update({
    where: { id: context.owner.id },
    data: {
      name: parsed.data.name,
      phone: nullable(parsed.data.phone),
      email: nullable(parsed.data.email),
      companyName: nullable(parsed.data.companyName),
      notes: nullable(parsed.data.notes),
    },
  });

  await logActivity({
    workspaceId: context.workspace.id,
    actor: context.user.name,
    action: "owner_updated",
    entityType: "Owner",
    entityId: owner.id,
    metadata: { name: owner.name },
  });

  revalidateOwnerSurfaces(owner.id);
  return NextResponse.json({ owner });
}

export async function DELETE(_request: NextRequest, { params }: { params: Params }) {
  const { ownerId } = await params;
  const context = await requireOwner(ownerId);
  if ("error" in context) {
    return NextResponse.json({ error: context.error }, { status: context.status });
  }

  const [vehicleCount, ledgerCount] = await Promise.all([
    prisma.vehicle.count({
      where: { ownerId: context.owner.id, workspaceId: context.workspace.id },
    }),
    prisma.ownerLedgerItem.count({
      where: { ownerId: context.owner.id, workspaceId: context.workspace.id },
    }),
  ]);
  if (vehicleCount > 0 || ledgerCount > 0) {
    return NextResponse.json(
      { error: "Owner still has vehicles or ledger rows. Reassign vehicles and preserve ledger data first." },
      { status: 400 },
    );
  }

  await prisma.shareLink.deleteMany({
    where: { ownerId: context.owner.id, workspaceId: context.workspace.id },
  });
  await prisma.owner.delete({ where: { id: context.owner.id } });

  await logActivity({
    workspaceId: context.workspace.id,
    actor: context.user.name,
    action: "owner_deleted",
    entityType: "Owner",
    entityId: context.owner.id,
  });

  revalidateOwnerSurfaces(context.owner.id);
  return NextResponse.json({ ok: true });
}
