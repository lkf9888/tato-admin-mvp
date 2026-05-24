import { readFile, stat } from "fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { OrderAttachmentKind } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { isImageAttachment, resolveUploadPath } from "@/lib/uploads";

export const runtime = "nodejs";

type Params = Promise<{ vehicleId: string }>;

export async function GET(request: NextRequest, { params }: { params: Params }) {
  const { vehicleId } = await params;
  const attachmentId = request.nextUrl.searchParams.get("attachmentId");

  if (!attachmentId) {
    return NextResponse.json({ error: "ATTACHMENT_ID_REQUIRED" }, { status: 400 });
  }

  const attachment = await prisma.orderAttachment.findFirst({
    where: {
      id: attachmentId,
      vehicleId,
      kind: OrderAttachmentKind.photo,
      isArchived: false,
      vehicle: {
        directBookingEnabled: true,
      },
    },
  });

  if (
    !attachment ||
    !isImageAttachment(attachment.contentType, attachment.filename)
  ) {
    return NextResponse.json({ error: "ATTACHMENT_NOT_FOUND" }, { status: 404 });
  }

  const absolutePath = resolveUploadPath(attachment.pathname);
  const fileStat = await stat(absolutePath).catch(() => null);
  if (!fileStat?.isFile()) {
    return NextResponse.json({ error: "FILE_NOT_FOUND" }, { status: 404 });
  }

  const file = await readFile(absolutePath);
  return new NextResponse(file, {
    headers: {
      "Content-Type": attachment.contentType || "image/jpeg",
      "Content-Length": String(file.length),
      "Content-Disposition": `inline; filename="${encodeURIComponent(attachment.filename || "vehicle-photo")}"`,
      "Cache-Control": "public, max-age=3600",
    },
  });
}
