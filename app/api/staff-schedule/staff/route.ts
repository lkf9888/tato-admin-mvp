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
  // `.parse()` throws, and so does `request.json()` on a body that
  // is not JSON. Uncaught, both leave the handler as a 500 -- which
  // is a crash report where a validation error belongs, and on the
  // staff routes it is reached from a phone on a bad connection.
  const parsedResult = staffSchema.safeParse(await request.json().catch(() => null));
  if (!parsedResult.success) {
    return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });
  }
  const parsed = parsedResult.data;
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
