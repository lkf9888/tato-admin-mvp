import { readFile, stat } from "fs/promises";
import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { resolveUploadPathWithin } from "@/lib/uploads";

export const runtime = "nodejs";

/**
 * A rental site's logo.
 *
 * Public and unauthenticated, like every other pixel of a published
 * site. The pathname is read off the row rather than taken from the
 * query, so the only thing a caller controls is which site it asks
 * about -- and an unpublished one answers 404 so a draft brand does
 * not leak ahead of its launch.
 */
export async function GET(request: NextRequest) {
  const siteId = request.nextUrl.searchParams.get("siteId");
  if (!siteId) {
    return NextResponse.json({ error: "SITE_ID_REQUIRED" }, { status: 400 });
  }

  const site = await prisma.rentalSite.findFirst({
    where: { id: siteId, isPublished: true },
    select: { id: true, logoPathname: true },
  });

  if (!site?.logoPathname) {
    return NextResponse.json({ error: "LOGO_NOT_FOUND" }, { status: 404 });
  }

  let absolutePath: string;
  try {
    absolutePath = resolveUploadPathWithin(site.logoPathname, `rental-sites/${site.id}`);
  } catch {
    return NextResponse.json({ error: "LOGO_NOT_FOUND" }, { status: 404 });
  }

  const fileStat = await stat(absolutePath).catch(() => null);
  if (!fileStat?.isFile()) {
    return NextResponse.json({ error: "FILE_NOT_FOUND" }, { status: 404 });
  }

  const file = await readFile(absolutePath);
  const extension = absolutePath.toLowerCase().split(".").pop() ?? "";
  const contentType =
    extension === "png"
      ? "image/png"
      : extension === "svg"
        ? "image/svg+xml"
        : extension === "webp"
          ? "image/webp"
          : "image/jpeg";

  return new NextResponse(file, {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(file.length),
      // The pathname carries a stamp, so a replaced logo is a new URL
      // and this can be cached hard.
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
