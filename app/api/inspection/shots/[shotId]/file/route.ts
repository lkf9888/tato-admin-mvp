import { readFile, stat } from "fs/promises";
import { NextRequest, NextResponse } from "next/server";

import { requireCurrentAdminContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveUploadPath } from "@/lib/uploads";

export const runtime = "nodejs";

type Params = Promise<{ shotId: string }>;

/**
 * Serves one condition photograph to the admin site.
 *
 * Streams the archived bytes untouched -- no resizing, no re-encoding. What
 * the browser renders is the file itself, so "save image" in the review page
 * yields the original rather than a derivative that would fail a claim. The
 * `ETag` is the file's own digest, which makes the cache validator and the
 * evidence identifier the same string.
 */
export async function GET(_request: NextRequest, { params }: { params: Params }) {
  const { shotId } = await params;
  const { workspace } = await requireCurrentAdminContext();

  const shot = await prisma.inspectionShot.findFirst({
    where: { id: shotId, workspaceId: workspace.id },
    select: { pathname: true, filename: true, sha256: true },
  });
  if (!shot) return NextResponse.json({ error: "SHOT_NOT_FOUND" }, { status: 404 });

  const absolutePath = resolveUploadPath(shot.pathname);
  const fileStat = await stat(absolutePath).catch(() => null);
  if (!fileStat?.isFile()) return NextResponse.json({ error: "FILE_NOT_FOUND" }, { status: 404 });

  const file = await readFile(absolutePath);
  return new NextResponse(file, {
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(file.length),
      "Content-Disposition": `inline; filename="${encodeURIComponent(shot.filename)}"`,
      ETag: `"${shot.sha256}"`,
      // Archived originals never change, so a long private cache is safe and
      // saves re-reading a couple of dozen multi-megabyte files on every view.
      "Cache-Control": "private, max-age=86400, immutable",
    },
  });
}
