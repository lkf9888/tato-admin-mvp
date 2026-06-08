import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { NextRequest, NextResponse } from "next/server";

import { requireCurrentAdminContext } from "@/lib/auth";
import {
  makeContractTemplateSourcePath,
  resolveUploadPath,
  sanitizeFilename,
} from "@/lib/uploads";

export const runtime = "nodejs";

const MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

export async function POST(req: NextRequest) {
  const { workspace } = await requireCurrentAdminContext();
  const formData = await req.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "请选择 PDF 或 Word 文件。" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "文件不能超过 25MB。" }, { status: 400 });
  }

  const contentType = file.type || inferContentType(file.name);
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    return NextResponse.json({ error: "只支持 PDF 或 DOCX 文件。" }, { status: 400 });
  }

  const filename = sanitizeFilename(file.name);
  const pathname = makeContractTemplateSourcePath(workspace.id, filename);
  const absolutePath = resolveUploadPath(pathname);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, Buffer.from(await file.arrayBuffer()));

  const origin = req.headers.get("origin") || new URL(req.url).origin;
  const publicBase = (process.env.APP_URL || origin).replace(/\/$/, "");

  return NextResponse.json({
    url: `${publicBase}/api/contracts/templates/source-file?pathname=${encodeURIComponent(pathname)}`,
    pathname,
    filename,
    contentType,
    size: file.size,
  });
}

function inferContentType(filename: string) {
  return filename.toLowerCase().endsWith(".docx")
    ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    : "application/pdf";
}
