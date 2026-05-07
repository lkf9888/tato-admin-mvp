import { createReadStream } from "fs";
import { stat } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { Readable } from "stream";

import { isAdminAuthenticated } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

function getUploadRoot() {
  return process.env.UPLOAD_DIR ?? path.join(process.cwd(), "uploads");
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authenticated = await isAdminAuthenticated();
  if (!authenticated) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const { id } = await params;
  const attachment = await prisma.orderAttachment.findUnique({
    where: { id },
  });

  if (!attachment) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const filePath = path.join(getUploadRoot(), attachment.orderId, attachment.storedName);
  const fileStat = await stat(filePath).catch(() => null);

  if (!fileStat) {
    return NextResponse.json({ error: "FILE_NOT_FOUND" }, { status: 404 });
  }

  const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream;

  return new NextResponse(stream, {
    headers: {
      "Content-Type": attachment.mimeType,
      "Content-Length": String(fileStat.size),
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(attachment.originalName)}`,
      "Cache-Control": "private, max-age=300",
    },
  });
}
