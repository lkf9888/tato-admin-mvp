import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireCurrentAdminContext } from "@/lib/auth";
import { logActivity } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import { createAvailableStaffShareToken } from "@/lib/staff-share";
import { createAvailableStaffMiniProgramCode } from "@/lib/staff-mini-program";

const staffSchema = z.object({
  name: z.string().trim().min(2),
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

export async function POST(request: NextRequest) {
  const { workspace, user } = await requireCurrentAdminContext();
  const parsed = staffSchema.parse(await request.json());
  const currentMaxSortOrder = await prisma.staffMember.aggregate({
    where: { workspaceId: workspace.id },
    _max: { sortOrder: true },
  });

  const staff = await prisma.staffMember.create({
    data: {
      workspaceId: workspace.id,
      name: parsed.name,
      phone: nullable(parsed.phone),
      email: nullable(parsed.email),
      role: nullable(parsed.role),
      color: nullable(parsed.color) ?? "#3456df",
      notes: nullable(parsed.notes),
      pinnedMessage: nullable(parsed.pinnedMessage),
      isActive: parsed.isActive ?? true,
      sortOrder: parsed.sortOrder ?? (currentMaxSortOrder._max.sortOrder ?? 0) + 1000,
      shareToken: await createAvailableStaffShareToken(),
      miniProgramCode: await createAvailableStaffMiniProgramCode(),
    },
  });

  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: "staff_member_created",
    entityType: "StaffMember",
    entityId: staff.id,
    metadata: { name: staff.name, role: staff.role },
  });

  return NextResponse.json({ staff });
}
