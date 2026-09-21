import { readFile, stat } from "fs/promises";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { resolveUploadPath } from "@/lib/uploads";

export const runtime = "nodejs";

type Params = Promise<{ token: string }>;

/**
 * Serve one shared attachment to somebody with the link and nothing
 * else.
 *
 * Deliberately unauthenticated -- that is the entire point -- so the
 * token does all the work and the query is by token alone. It cannot
 * be widened to "this order's files" or "this workspace's files" by
 * guessing an id, because no id is accepted.
 *
 * `noindex` because a link meant for one adjuster should not end up
 * in a search engine, and no caching by shared proxies because the
 * link can be revoked.
 */
export async function GET(_request: Request, { params }: { params: Params }) {
  const { token } = await params;

  if (!token || token.length < 20) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const attachment = await prisma.orderAttachment.findFirst({
    where: { shareToken: token, isArchived: false },
    select: { pathname: true, contentType: true, filename: true },
  });

  // The same 404 for a wrong token, a revoked one and a deleted file.
  // Telling them apart would let somebody probe for live tokens.
  if (!attachment) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const absolutePath = resolveUploadPath(attachment.pathname);
  const fileStat = await stat(absolutePath).catch(() => null);
  if (!fileStat?.isFile()) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const file = await readFile(absolutePath);
  return new NextResponse(file, {
    headers: {
      "Content-Type": attachment.contentType || "application/octet-stream",
      "Content-Length": String(file.length),
      "Content-Disposition": `inline; filename="${encodeURIComponent(
        attachment.filename || "attachment",
      )}"`,
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
