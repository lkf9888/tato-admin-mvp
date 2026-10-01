import { readFile } from "fs/promises";
import { NextResponse } from "next/server";

import { loadBookingByToken } from "@/lib/booking-access";
import { findHandoverPhoto } from "@/lib/direct-booking-handover";
import { resolveUploadPath } from "@/lib/uploads";

export const runtime = "nodejs";

type Params = Promise<{ token: string; photoId: string }>;

/** A renter's own handover photo, for their booking page. */
export async function GET(_request: Request, { params }: { params: Params }) {
  const { token, photoId } = await params;
  const order = await loadBookingByToken(token);
  const photo = order ? await findHandoverPhoto(photoId) : null;
  // Only their own photos on their own booking: the operator's are
  // evidence for the business, not part of the renter's page.
  if (!order || !photo || photo.handover.orderId !== order.id || photo.handover.party !== "renter") {
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
