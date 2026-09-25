import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { OrderAttachmentKind } from "@prisma/client";
import { z } from "zod";

import { requireCurrentAdminContext } from "@/lib/auth";
import { logActivity } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import { makeVehicleAttachmentPath, resolveUploadPath, sanitizeFilename } from "@/lib/uploads";

export const runtime = "nodejs";

type Params = Promise<{ vehicleId: string }>;

const MAX_URLS = 12;
const MAX_BYTES = 8 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;
const CONTENT_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const bodySchema = z.object({
  urls: z.array(z.string().url()).min(1).max(MAX_URLS),
});

/**
 * Only the operator's own listing photos, on Turo's image CDN.
 *
 * The server fetches whatever passes this check, so it is an allowlist
 * rather than a blocklist: one host, https, one path prefix. Anything
 * looser turns an admin convenience into a way to make the server
 * request internal addresses.
 */
function readTuroImage(raw: string) {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.hostname !== "images.turo.com") return null;
    if (url.username || url.password || url.port) return null;
    const match = /^\/media\/vehicle\/images\/([A-Za-z0-9_-]{8,64})\.[0-9x]+\.(?:jpg|jpeg|png|webp)$/.exec(url.pathname);
    return match ? { url, imageId: match[1] } : null;
  } catch {
    return null;
  }
}

/**
 * Copy a car's listing photos from Turo into TATO, in order.
 *
 * The browser cannot do this itself -- Turo's CDN sends no CORS
 * headers -- so the admin page hands over the URLs and the server
 * fetches them. Each photo is stored as `turo-<imageId>.<ext>`, and one
 * already on the car under that name is skipped: a run that failed
 * halfway can simply be run again.
 */
export async function POST(request: NextRequest, { params }: { params: Params }) {
  const { vehicleId } = await params;
  const { workspace, user } = await requireCurrentAdminContext();

  const vehicle = await prisma.vehicle.findFirst({
    where: { id: vehicleId, workspaceId: workspace.id },
    select: { id: true, plateNumber: true },
  });
  if (!vehicle) return NextResponse.json({ error: "VEHICLE_NOT_FOUND" }, { status: 404 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });

  const images = parsed.data.urls.map(readTuroImage);
  if (images.some((image) => !image)) {
    return NextResponse.json({ error: "URL_NOT_ALLOWED" }, { status: 400 });
  }

  const existing = new Set(
    (
      await prisma.orderAttachment.findMany({
        where: { vehicleId: vehicle.id, isArchived: false, filename: { startsWith: "turo-" } },
        select: { filename: true },
      })
    ).map((row) => row.filename?.replace(/\.\w+$/, "")),
  );

  const imported: string[] = [];
  const skipped: string[] = [];
  const failed: Array<{ imageId: string; reason: string }> = [];

  // One at a time, in the order given: upload order is display order,
  // and the first photo is the cover on the fleet page.
  for (const image of images as Array<{ url: URL; imageId: string }>) {
    // Sanitised before comparing: the sanitiser collapses "--", which
    // Turo's ids contain, so the raw id would never match what was saved.
    const stem = sanitizeFilename(`turo-${image.imageId}`);
    if (existing.has(stem)) {
      skipped.push(image.imageId);
      continue;
    }

    try {
      const response = await fetch(image.url, {
        redirect: "error",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`HTTP_${response.status}`);
      const contentType = (response.headers.get("content-type") ?? "").split(";")[0].trim();
      const extension = CONTENT_TYPES[contentType];
      if (!extension) throw new Error("NOT_AN_IMAGE");
      const declared = Number(response.headers.get("content-length") ?? 0);
      if (declared > MAX_BYTES) throw new Error("TOO_LARGE");
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length === 0 || bytes.length > MAX_BYTES) throw new Error("BAD_SIZE");

      const filename = `${stem}.${extension}`;
      const pathname = makeVehicleAttachmentPath(vehicle.id, filename);
      const absolutePath = resolveUploadPath(pathname);
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, bytes);

      await prisma.orderAttachment.create({
        data: {
          workspaceId: workspace.id,
          vehicleId: vehicle.id,
          kind: OrderAttachmentKind.photo,
          url: null,
          pathname,
          filename,
          contentType,
          size: bytes.length,
        },
      });
      existing.add(stem);
      imported.push(image.imageId);
    } catch (error) {
      failed.push({
        imageId: image.imageId,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (imported.length > 0) {
    await logActivity({
      workspaceId: workspace.id,
      actor: user.name,
      action: "vehicle_attachments_uploaded",
      entityType: "Vehicle",
      entityId: vehicle.id,
      metadata: { vehicleId: vehicle.id, plateNumber: vehicle.plateNumber, source: "turo", imported },
    });
    ["/vehicles", "/photos", "/documents"].forEach((surface) => revalidatePath(surface));
  }

  return NextResponse.json({ imported: imported.length, skipped: skipped.length, failed });
}
