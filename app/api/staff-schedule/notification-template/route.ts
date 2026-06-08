import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireCurrentAdminContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { normalizeStaffTaskNotificationTemplate } from "@/lib/staff-task-notification-template";

const templateSchema = z.object({
  emailSubjectTemplate: z.string().trim().max(300).optional().or(z.literal("")),
  emailBodyTemplate: z.string().trim().max(5000).optional().or(z.literal("")),
  smsBodyTemplate: z.string().trim().max(1200).optional().or(z.literal("")),
});

function nullable(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export async function PATCH(request: NextRequest) {
  const { workspace } = await requireCurrentAdminContext();
  const parsed = templateSchema.parse(await request.json());

  const template = await prisma.staffTaskNotificationTemplate.upsert({
    where: { workspaceId: workspace.id },
    create: {
      workspaceId: workspace.id,
      emailSubjectTemplate: nullable(parsed.emailSubjectTemplate),
      emailBodyTemplate: nullable(parsed.emailBodyTemplate),
      smsBodyTemplate: nullable(parsed.smsBodyTemplate),
    },
    update: {
      emailSubjectTemplate: nullable(parsed.emailSubjectTemplate),
      emailBodyTemplate: nullable(parsed.emailBodyTemplate),
      smsBodyTemplate: nullable(parsed.smsBodyTemplate),
    },
  });

  revalidatePath("/staff-schedule");

  return NextResponse.json({
    template: normalizeStaffTaskNotificationTemplate(template),
  });
}
