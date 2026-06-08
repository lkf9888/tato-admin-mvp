import { readFile, stat } from "fs/promises";
import { NextRequest, NextResponse } from "next/server";

import { requireCurrentAdminContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveUploadPath } from "@/lib/uploads";

export const runtime = "nodejs";

type Params = Promise<{ id: string }>;

export async function GET(request: NextRequest, { params }: { params: Params }) {
  const { id } = await params;
  const kind = request.nextUrl.searchParams.get("kind") === "source" ? "source" : "pdf";

  const template = await prisma.contractTemplate.findFirst({
    where: { id, active: true },
    select: {
      id: true,
      workspaceId: true,
      name: true,
      pdfPathname: true,
      pdfFilename: true,
      pdfContentType: true,
      sourcePathname: true,
      sourceFilename: true,
      sourceContentType: true,
    },
  });
  if (!template) {
    return NextResponse.json({ error: "TEMPLATE_NOT_FOUND" }, { status: 404 });
  }

  if (kind === "source") {
    const { workspace } = await requireCurrentAdminContext();
    if (template.workspaceId !== workspace.id) {
      return NextResponse.json({ error: "TEMPLATE_NOT_FOUND" }, { status: 404 });
    }
  }

  const pathname = kind === "source" ? template.sourcePathname : template.pdfPathname;
  if (!pathname) {
    return NextResponse.json({ error: "FILE_NOT_FOUND" }, { status: 404 });
  }

  const absolutePath = resolveUploadPath(pathname);
  const fileStat = await stat(absolutePath).catch(() => null);
  if (!fileStat?.isFile()) {
    return NextResponse.json({ error: "FILE_NOT_FOUND" }, { status: 404 });
  }

  const file = await readFile(absolutePath);
  const filename =
    kind === "source"
      ? template.sourceFilename || "contract-source"
      : template.pdfFilename || `${template.name}.pdf`;
  const contentType =
    kind === "source"
      ? template.sourceContentType || "application/octet-stream"
      : template.pdfContentType || "application/pdf";

  return new NextResponse(file, {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(file.length),
      "Content-Disposition": `inline; filename="${encodeURIComponent(filename)}"`,
      "Cache-Control": kind === "source" ? "private, max-age=300" : "public, max-age=300",
    },
  });
}
