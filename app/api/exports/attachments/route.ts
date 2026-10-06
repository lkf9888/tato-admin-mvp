import { NextResponse } from "next/server";

import { buildAttachmentManifest, parseAttachmentFilters } from "@/lib/attachment-list";
import { requireCurrentWorkspace } from "@/lib/auth";

/**
 * The list of files a ZIP of the photos or documents page would hold --
 * paths and download links, no bytes. The browser fetches each file and
 * zips them itself (jszip), so a large archive never sits in the
 * server's memory or runs into a request timeout.
 */
export async function GET(request: Request) {
  const workspace = await requireCurrentWorkspace();
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") === "document" ? "document" : "photo";
  const zh = url.searchParams.get("locale") !== "en";
  const items = await buildAttachmentManifest(
    workspace.id,
    { kind, ...parseAttachmentFilters({ vehicle: url.searchParams.get("vehicle"), q: url.searchParams.get("q") }) },
    { vehicleFiles: zh ? "车辆资料" : "Vehicle files" },
  );
  return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store" } });
}
