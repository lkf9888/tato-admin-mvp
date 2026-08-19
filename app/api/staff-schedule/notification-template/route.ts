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
  // `.parse()` throws, and so does `request.json()` on a body that
  // is not JSON. Uncaught, both leave the handler as a 500 -- which
  // is a crash report where a validation error belongs, and on the
  // staff routes it is reached from a phone on a bad connection.
  const parsedResult = templateSchema.safeParse(await request.json().catch(() => null));
  if (!parsedResult.success) {
    return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });
  }
  const parsed = parsedResult.data;
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
