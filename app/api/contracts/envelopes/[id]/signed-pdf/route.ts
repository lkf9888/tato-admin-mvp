import { readFile, stat } from "fs/promises";
import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { resolveUploadPath } from "@/lib/uploads";

export const runtime = "nodejs";

type Params = Promise<{ id: string }>;

export async function GET(_request: NextRequest, { params }: { params: Params }) {
  const { id } = await params;
  const envelope = await prisma.contractEnvelope.findFirst({
    where: { id, status: "COMPLETED" },
    select: {
      title: true,
      signedPdfPathname: true,
      signedPdfFilename: true,
      signedPdfContentType: true,
    },
  });
  if (!envelope?.signedPdfPathname) {
    return NextResponse.json({ error: "SIGNED_PDF_NOT_FOUND" }, { status: 404 });
  }

  const absolutePath = resolveUploadPath(envelope.signedPdfPathname);
  const fileStat = await stat(absolutePath).catch(() => null);
  if (!fileStat?.isFile()) {
    return NextResponse.json({ error: "FILE_NOT_FOUND" }, { status: 404 });
  }

  const file = await readFile(absolutePath);
  return new NextResponse(file, {
    headers: {
      "Content-Type": envelope.signedPdfContentType || "application/pdf",
      "Content-Length": String(file.length),
      "Content-Disposition": `inline; filename="${encodeURIComponent(envelope.signedPdfFilename || `${envelope.title} - signed.pdf`)}"`,
      "Cache-Control": "public, max-age=300",
    },
  });
}
