import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { AttachmentCategory } from "@prisma/client";
import { NextResponse } from "next/server";

import { isAdminAuthenticated } from "@/lib/auth";
import { logActivity } from "@/lib/orders";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

function getUploadRoot() {
  return process.env.UPLOAD_DIR ?? path.join(process.cwd(), "uploads");
}

function cleanFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "upload";
}

function isValidCategory(value: FormDataEntryValue | null): value is AttachmentCategory {
  return value === AttachmentCategory.media || value === AttachmentCategory.contract;
}

function isAllowedFileForCategory(file: File, category: AttachmentCategory) {
  if (category === AttachmentCategory.media) {
    return file.type.startsWith("image/") || file.type.startsWith("video/");
  }

  return Boolean(file.name);
}

export async function POST(request: Request) {
  const authenticated = await isAdminAuthenticated();
  if (!authenticated) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const formData = await request.formData();
  const orderId = formData.get("orderId")?.toString();
  const categoryValue = formData.get("category");

  if (!orderId || !isValidCategory(categoryValue)) {
    return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
  });

  if (!order) {
    return NextResponse.json({ error: "ORDER_NOT_FOUND" }, { status: 404 });
  }

  const files = formData
    .getAll("files")
    .filter((value): value is File => value instanceof File && value.size > 0);

  if (files.length === 0) {
    return NextResponse.json({ error: "NO_FILES" }, { status: 400 });
  }

  const invalidFile = files.find(
    (file) => file.size > MAX_UPLOAD_BYTES || !isAllowedFileForCategory(file, categoryValue),
  );

  if (invalidFile) {
    return NextResponse.json({ error: "INVALID_FILE" }, { status: 400 });
  }

  const uploadRoot = getUploadRoot();
  const orderUploadDir = path.join(uploadRoot, orderId);
  await mkdir(orderUploadDir, { recursive: true });

  const attachments = [];

  for (const file of files) {
    const originalName = cleanFileName(file.name);
    const extension = path.extname(originalName);
    const storedName = `${categoryValue}-${randomUUID()}${extension}`;
    const filePath = path.join(orderUploadDir, storedName);
    const bytes = Buffer.from(await file.arrayBuffer());

    await writeFile(filePath, bytes);

    const attachment = await prisma.orderAttachment.create({
      data: {
        orderId,
        category: categoryValue,
        originalName,
        storedName,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
      },
    });

    attachments.push(attachment);
  }

  await logActivity({
    actor: "Admin",
    action: categoryValue === AttachmentCategory.media ? "order_media_uploaded" : "order_file_uploaded",
    entityType: "Order",
    entityId: orderId,
    metadata: { attachmentCount: attachments.length },
  });

  return NextResponse.json({ attachments });
}
