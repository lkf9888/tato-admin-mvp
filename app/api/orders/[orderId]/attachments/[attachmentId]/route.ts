import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";

import { requireCurrentAdminContext } from "@/lib/auth";
import { logActivity } from "@/lib/orders";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type Params = Promise<{ orderId: string; attachmentId: string }>;

function revalidateAttachmentSurfaces() {
  ["/calendar", "/orders", "/photos", "/documents"].forEach((surface) => revalidatePath(surface));
}

export async function DELETE(_request: NextRequest, { params }: { params: Params }) {
  const { orderId, attachmentId } = await params;
  const { workspace, user } = await requireCurrentAdminContext();

  const attachment = await prisma.orderAttachment.findFirst({
    where: {
      id: attachmentId,
      orderId,
      workspaceId: workspace.id,
      isArchived: false,
    },
  });

  if (!attachment) {
    return NextResponse.json({ error: "ATTACHMENT_NOT_FOUND" }, { status: 404 });
  }

  const archived = await prisma.orderAttachment.update({
    where: { id: attachment.id },
    data: { isArchived: true },
  });

  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: "order_attachment_archived",
    entityType: "OrderAttachment",
    entityId: archived.id,
    metadata: {
      orderId,
      filename: archived.filename,
      kind: archived.kind,
    },
  });

  revalidateAttachmentSurfaces();
  return NextResponse.json({ ok: true });
}
