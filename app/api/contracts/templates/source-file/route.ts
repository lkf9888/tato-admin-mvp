import { readFile, stat } from "fs/promises";
import { NextRequest, NextResponse } from "next/server";

import { requireCurrentAdminContext } from "@/lib/auth";
import { resolveUploadPathWithin } from "@/lib/uploads";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const { workspace } = await requireCurrentAdminContext();
  const pathname = request.nextUrl.searchParams.get("pathname") || "";

  // Resolve first, then assert containment. Checking the raw string
  // before normalizing let `../` sequences escape the workspace
  // directory while still satisfying the prefix test.
  let absolutePath: string;
  try {
    absolutePath = resolveUploadPathWithin(
      pathname,
      `contracts/templates/${workspace.id}/sources`,
    );
  } catch {
    return NextResponse.json({ error: "FILE_NOT_FOUND" }, { status: 404 });
  }
  const fileStat = await stat(absolutePath).catch(() => null);
  if (!fileStat?.isFile()) {
    return NextResponse.json({ error: "FILE_NOT_FOUND" }, { status: 404 });
  }

  const file = await readFile(absolutePath);
  return new NextResponse(file, {
    headers: {
      "Content-Type": inferContentType(pathname),
      "Content-Length": String(file.length),
      "Content-Disposition": `inline; filename="${encodeURIComponent(pathname.split("/").pop() || "contract-source")}"`,
      "Cache-Control": "private, max-age=300",
    },
  });
}

function inferContentType(pathname: string) {
  return pathname.toLowerCase().endsWith(".docx")
    ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    : "application/pdf";
}
