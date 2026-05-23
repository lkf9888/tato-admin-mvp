import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireCurrentAdminContext } from "@/lib/auth";
import { logActivity } from "@/lib/orders";
import { prisma } from "@/lib/prisma";

const ownerSchema = z.object({
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

function revalidateOwnerSurfaces(ownerId?: string) {
  revalidatePath("/owners");
  revalidatePath("/owner-statements");
  if (ownerId) {
    revalidatePath(`/owners/${ownerId}`);
    revalidatePath(`/owners/${ownerId}/ledger`);
  }
}

export async function POST(request: NextRequest) {
  const { workspace, user } = await requireCurrentAdminContext();
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const parsed = ownerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid owner" }, { status: 400 });
  }

  const owner = await prisma.owner.create({
    data: {
      workspaceId: workspace.id,
      name: parsed.data.name,
      phone: nullable(parsed.data.phone),
      email: nullable(parsed.data.email),
      companyName: nullable(parsed.data.companyName),
      notes: nullable(parsed.data.notes),
    },
  });

  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: "owner_created",
    entityType: "Owner",
    entityId: owner.id,
    metadata: { name: owner.name },
  });

  revalidateOwnerSurfaces(owner.id);
  return NextResponse.json({ owner });
}
