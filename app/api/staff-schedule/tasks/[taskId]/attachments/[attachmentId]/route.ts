import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";

import { requireCurrentAdminContext } from "@/lib/auth";
import { logActivity } from "@/lib/orders";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type Params = Promise<{ taskId: string; attachmentId: string }>;

export async function DELETE(_request: NextRequest, { params }: { params: Params }) {
  const { taskId, attachmentId } = await params;
  const { workspace, user } = await requireCurrentAdminContext();

  const attachment = await prisma.staffTaskAttachment.findFirst({
    where: {
      id: attachmentId,
      taskId,
      workspaceId: workspace.id,
      isArchived: false,
    },
  });

  if (!attachment) {
    return NextResponse.json({ error: "ATTACHMENT_NOT_FOUND" }, { status: 404 });
  }

  const archived = await prisma.staffTaskAttachment.update({
    where: { id: attachment.id },
    data: { isArchived: true },
  });

  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: "staff_task_attachment_archived",
    entityType: "StaffTaskAttachment",
    entityId: archived.id,
    metadata: {
      taskId,
      filename: archived.filename,
      kind: archived.kind,
    },
  });

  revalidatePath("/staff-schedule");
  return NextResponse.json({ ok: true });
}
