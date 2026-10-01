import { readFile } from "fs/promises";
import { NextResponse } from "next/server";

import { requireCurrentAdminContext } from "@/lib/auth";
import { findHandoverPhoto } from "@/lib/direct-booking-handover";
import { resolveUploadPath } from "@/lib/uploads";

export const runtime = "nodejs";

type Params = Promise<{ orderId: string; photoId: string }>;

/** Any handover photo on an order in the operator's workspace. */
export async function GET(_request: Request, { params }: { params: Params }) {
  const { orderId, photoId } = await params;
  const { workspace } = await requireCurrentAdminContext();
  const photo = await findHandoverPhoto(photoId);
  if (!photo || photo.handover.orderId !== orderId || photo.handover.workspaceId !== workspace.id) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  const bytes = await readFile(resolveUploadPath(photo.pathname)).catch(() => null);
  if (!bytes) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "content-type": photo.contentType,
      "cache-control": "private, max-age=3600",
    },
  });
}
