import { readFile, stat } from "fs/promises";
import { NextResponse } from "next/server";

import { findSharedTripPhotos } from "@/lib/order-photo-share";
import { prisma } from "@/lib/prisma";
import { resolveUploadPath } from "@/lib/uploads";

export const runtime = "nodejs";

type Params = Promise<{ token: string; attachmentId: string }>;

/**
 * One photo from a shared trip. Unauthenticated by design: the token is
 * checked first, and then only a photo of that very trip is served -- an
 * attachment id from anywhere else is the same 404 as a bad token.
 */
export async function GET(_request: Request, { params }: { params: Params }) {
  const { token, attachmentId } = await params;
  const shared = await findSharedTripPhotos(token);
  if (!shared || !shared.order.attachments.some((photo) => photo.id === attachmentId)) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const attachment = await prisma.orderAttachment.findUnique({
    where: { id: attachmentId },
    select: { pathname: true, contentType: true, filename: true },
  });
  if (!attachment) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const absolutePath = resolveUploadPath(attachment.pathname);
  const fileStat = await stat(absolutePath).catch(() => null);
  if (!fileStat?.isFile()) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const file = await readFile(absolutePath);
  return new NextResponse(file, {
    headers: {
      "Content-Type": attachment.contentType || "application/octet-stream",
      "Content-Length": String(file.length),
      "Content-Disposition": `inline; filename="${encodeURIComponent(attachment.filename || "photo")}"`,
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
