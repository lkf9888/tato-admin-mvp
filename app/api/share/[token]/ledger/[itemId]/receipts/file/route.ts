import { readFile, stat } from "fs/promises";
import { NextRequest, NextResponse } from "next/server";

import { hasShareAccess } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveUploadPath } from "@/lib/uploads";

export const runtime = "nodejs";

type Params = Promise<{ token: string; itemId: string }>;

export async function GET(request: NextRequest, { params }: { params: Params }) {
  const { token, itemId } = await params;
  const receiptId = request.nextUrl.searchParams.get("receiptId");
  if (!receiptId) {
    return NextResponse.json({ error: "RECEIPT_ID_REQUIRED" }, { status: 400 });
  }

  const shareLink = await prisma.shareLink.findUnique({
    where: { token },
    select: {
      workspaceId: true,
      ownerId: true,
      passwordHash: true,
      expiresAt: true,
      isActive: true,
    },
  });

  if (!shareLink || !shareLink.isActive || (shareLink.expiresAt && shareLink.expiresAt < new Date())) {
    return NextResponse.json({ error: "SHARE_LINK_UNAVAILABLE" }, { status: 404 });
  }

  if (shareLink.passwordHash && !(await hasShareAccess(token, shareLink.passwordHash))) {
    return NextResponse.json({ error: "SHARE_LINK_LOCKED" }, { status: 401 });
  }

  const receipt = await prisma.ownerLedgerReceipt.findFirst({
    where: {
      id: receiptId,
      itemId,
      workspaceId: shareLink.workspaceId,
      item: {
        ownerId: shareLink.ownerId,
      },
    },
  });

  if (!receipt) {
    return NextResponse.json({ error: "RECEIPT_NOT_FOUND" }, { status: 404 });
  }

  const absolutePath = resolveUploadPath(receipt.pathname);
  const fileStat = await stat(absolutePath).catch(() => null);
  if (!fileStat?.isFile()) {
    return NextResponse.json({ error: "FILE_NOT_FOUND" }, { status: 404 });
  }

  const file = await readFile(absolutePath);
  return new NextResponse(file, {
    headers: {
      "Content-Type": receipt.contentType || "application/octet-stream",
      "Content-Length": String(file.length),
      "Content-Disposition": `inline; filename="${encodeURIComponent(receipt.filename || "receipt")}"`,
      "Cache-Control": "private, max-age=300",
    },
  });
}
