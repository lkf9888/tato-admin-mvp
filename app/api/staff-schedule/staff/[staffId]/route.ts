import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireCurrentAdminContext } from "@/lib/auth";
import { logActivity } from "@/lib/orders";
import { prisma } from "@/lib/prisma";

type Params = Promise<{ staffId: string }>;

const staffSchema = z.object({
  name: z.string().trim().min(2).optional(),
  phone: z.string().trim().optional().or(z.literal("")),
  email: z.string().trim().email().optional().or(z.literal("")),
  role: z.string().trim().optional().or(z.literal("")),
  color: z.string().trim().optional().or(z.literal("")),
  notes: z.string().trim().optional().or(z.literal("")),
  pinnedMessage: z.string().trim().optional().or(z.literal("")),
  isActive: z.boolean().optional(),
  sortOrder: z.coerce.number().int().optional(),
});

function nullable(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

async function requireStaff(workspaceId: string, staffId: string) {
  return prisma.staffMember.findFirst({
    where: { id: staffId, workspaceId },
  });
}

export async function PATCH(request: NextRequest, { params }: { params: Params }) {
  const { staffId } = await params;
  const { workspace, user } = await requireCurrentAdminContext();
  const existing = await requireStaff(workspace.id, staffId);
  if (!existing) {
    return NextResponse.json({ error: "STAFF_NOT_FOUND" }, { status: 404 });
  }

  const parsed = staffSchema.parse(await request.json());
  const staff = await prisma.staffMember.update({
    where: { id: existing.id },
    data: {
      name: parsed.name ?? existing.name,
      phone: parsed.phone === undefined ? existing.phone : nullable(parsed.phone),
      email: parsed.email === undefined ? existing.email : nullable(parsed.email),
      role: parsed.role === undefined ? existing.role : nullable(parsed.role),
      color: parsed.color === undefined ? existing.color : nullable(parsed.color) ?? existing.color,
      notes: parsed.notes === undefined ? existing.notes : nullable(parsed.notes),
      pinnedMessage:
        parsed.pinnedMessage === undefined
          ? existing.pinnedMessage
          : nullable(parsed.pinnedMessage),
      isActive: parsed.isActive ?? existing.isActive,
      sortOrder: parsed.sortOrder ?? existing.sortOrder,
    },
  });

  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: "staff_member_updated",
    entityType: "StaffMember",
    entityId: staff.id,
    metadata: { name: staff.name, active: staff.isActive },
  });

  return NextResponse.json({ staff });
}

export async function DELETE(_request: NextRequest, { params }: { params: Params }) {
  const { staffId } = await params;
  const { workspace, user } = await requireCurrentAdminContext();
  const existing = await requireStaff(workspace.id, staffId);
  if (!existing) {
    return NextResponse.json({ error: "STAFF_NOT_FOUND" }, { status: 404 });
  }

  const staff = await prisma.staffMember.update({
    where: { id: existing.id },
    data: { isActive: false },
  });

  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: "staff_member_deactivated",
    entityType: "StaffMember",
    entityId: staff.id,
    metadata: { name: staff.name },
  });

  return NextResponse.json({ staff });
}
