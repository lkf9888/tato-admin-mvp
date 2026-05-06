import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { OrderAttachmentKind } from "@prisma/client";

import { requireCurrentAdminContext } from "@/lib/auth";
import { logActivity } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import { makeOrderAttachmentPath, resolveUploadPath, sanitizeFilename } from "@/lib/uploads";

export const runtime = "nodejs";

type Params = Promise<{ orderId: string }>;

function revalidateAttachmentSurfaces() {
  ["/calendar", "/orders", "/photos", "/documents"].forEach((surface) => revalidatePath(surface));
}

async function requireOrder(orderId: string) {
  const { workspace, user } = await requireCurrentAdminContext();
  const order = await prisma.order.findFirst({
    where: { id: orderId, workspaceId: workspace.id, isArchived: false },
    select: { id: true, workspaceId: true, renterName: true },
  });
  if (!order) return { error: "ORDER_NOT_FOUND" as const, status: 404 as const };
  return { workspace, user, order };
}

function normalizeKind(value: FormDataEntryValue | null, file: File) {
  const stringValue = typeof value === "string" ? value : "";
  if (stringValue === OrderAttachmentKind.photo || stringValue === OrderAttachmentKind.document) {
    return stringValue;
  }
  const type = file.type.toLowerCase();
  return type.startsWith("image/") || type.startsWith("video/")
    ? OrderAttachmentKind.photo
    : OrderAttachmentKind.document;
}

export async function GET(_request: NextRequest, { params }: { params: Params }) {
  const { orderId } = await params;
  const context = await requireOrder(orderId);
  if ("error" in context) {
    return NextResponse.json({ error: context.error }, { status: context.status });
  }

  const attachments = await prisma.orderAttachment.findMany({
    where: {
      workspaceId: context.workspace.id,
      orderId: context.order.id,
      isArchived: false,
    },
    orderBy: { uploadedAt: "asc" },
  });

  return NextResponse.json({
    attachments: attachments.map((attachment) => ({
      ...attachment,
      url: `/api/orders/${context.order.id}/attachments/file?attachmentId=${attachment.id}`,
    })),
  });
}

export async function POST(request: NextRequest, { params }: { params: Params }) {
  const { orderId } = await params;
  const context = await requireOrder(orderId);
  if ("error" in context) {
    return NextResponse.json({ error: context.error }, { status: context.status });
  }

  const formData = await request.formData();
  const files = formData.getAll("files").filter((entry): entry is File => entry instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "NO_FILES" }, { status: 400 });
  }

  const created = [];
  for (const file of files) {
    const safeName = sanitizeFilename(file.name);
    const pathname = makeOrderAttachmentPath(context.order.id, safeName);
    const absolutePath = resolveUploadPath(pathname);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, Buffer.from(await file.arrayBuffer()));

    const attachment = await prisma.orderAttachment.create({
      data: {
        workspaceId: context.workspace.id,
        orderId: context.order.id,
        kind: normalizeKind(formData.get("kind"), file),
        url: null,
        pathname,
        filename: safeName,
        contentType: file.type || null,
        size: file.size,
      },
    });

    created.push({
      ...attachment,
      url: `/api/orders/${context.order.id}/attachments/file?attachmentId=${attachment.id}`,
    });
  }

  await logActivity({
    workspaceId: context.workspace.id,
    actor: context.user.name,
    action: "order_attachments_uploaded",
    entityType: "Order",
    entityId: context.order.id,
    metadata: {
      orderId: context.order.id,
      files: created.map((attachment) => attachment.filename),
    },
  });

  revalidateAttachmentSurfaces();
  return NextResponse.json({ attachments: created });
}
