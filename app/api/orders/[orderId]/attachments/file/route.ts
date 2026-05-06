import { readFile, stat } from "fs/promises";
import { NextRequest, NextResponse } from "next/server";

import { requireCurrentAdminContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveUploadPath } from "@/lib/uploads";

export const runtime = "nodejs";

type Params = Promise<{ orderId: string }>;

export async function GET(request: NextRequest, { params }: { params: Params }) {
  const { orderId } = await params;
  const attachmentId = request.nextUrl.searchParams.get("attachmentId");
  if (!attachmentId) {
    return NextResponse.json({ error: "ATTACHMENT_ID_REQUIRED" }, { status: 400 });
  }

  const { workspace } = await requireCurrentAdminContext();
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

  const absolutePath = resolveUploadPath(attachment.pathname);
  const fileStat = await stat(absolutePath).catch(() => null);
  if (!fileStat?.isFile()) {
    return NextResponse.json({ error: "FILE_NOT_FOUND" }, { status: 404 });
  }

  const file = await readFile(absolutePath);
  return new NextResponse(file, {
    headers: {
      "Content-Type": attachment.contentType || "application/octet-stream",
      "Content-Length": String(file.length),
      "Content-Disposition": `inline; filename="${encodeURIComponent(attachment.filename || "attachment")}"`,
      "Cache-Control": "private, max-age=300",
    },
  });
}
