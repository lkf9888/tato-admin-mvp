import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { OrderAttachmentKind } from "@prisma/client";

import { requireCurrentAdminContext } from "@/lib/auth";
import { logActivity } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import { makeVehicleAttachmentPath, resolveUploadPath, sanitizeFilename } from "@/lib/uploads";

export const runtime = "nodejs";

type Params = Promise<{ vehicleId: string }>;

function revalidateAttachmentSurfaces() {
  ["/vehicles", "/photos", "/documents"].forEach((surface) => revalidatePath(surface));
}

async function requireVehicle(vehicleId: string) {
  const { workspace, user } = await requireCurrentAdminContext();
  const vehicle = await prisma.vehicle.findFirst({
    where: { id: vehicleId, workspaceId: workspace.id },
    select: { id: true, workspaceId: true, plateNumber: true, nickname: true },
  });
  if (!vehicle) return { error: "VEHICLE_NOT_FOUND" as const, status: 404 as const };
  return { workspace, user, vehicle };
}

function normalizeKind(value: FormDataEntryValue | null, file: File) {
  const stringValue = typeof value === "string" ? value : "";
  if (stringValue === OrderAttachmentKind.photo || stringValue === OrderAttachmentKind.document) {
    return stringValue;
  }
  const type = file.type.toLowerCase();
  return type.startsWith("image/") || type.startsWith("video/")
    ? OrderAttachmentKind.photo
    : OrderAttachmentKind.document;
}

export async function GET(_request: NextRequest, { params }: { params: Params }) {
  const { vehicleId } = await params;
  const context = await requireVehicle(vehicleId);
  if ("error" in context) {
    return NextResponse.json({ error: context.error }, { status: context.status });
  }

  const attachments = await prisma.orderAttachment.findMany({
    where: {
      workspaceId: context.workspace.id,
      vehicleId: context.vehicle.id,
      isArchived: false,
    },
    orderBy: { uploadedAt: "asc" },
  });

  return NextResponse.json({
    attachments: attachments.map((attachment) => ({
      ...attachment,
      url: `/api/vehicles/${context.vehicle.id}/attachments/file?attachmentId=${attachment.id}`,
    })),
  });
}

export async function POST(request: NextRequest, { params }: { params: Params }) {
  const { vehicleId } = await params;
  const context = await requireVehicle(vehicleId);
  if ("error" in context) {
    return NextResponse.json({ error: context.error }, { status: context.status });
  }

  const formData = await request.formData();
  const files = formData.getAll("files").filter((entry): entry is File => entry instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "NO_FILES" }, { status: 400 });
  }

  const created = [];
  for (const file of files) {
    const safeName = sanitizeFilename(file.name);
    const pathname = makeVehicleAttachmentPath(context.vehicle.id, safeName);
    const absolutePath = resolveUploadPath(pathname);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, Buffer.from(await file.arrayBuffer()));

    const attachment = await prisma.orderAttachment.create({
      data: {
        workspaceId: context.workspace.id,
        vehicleId: context.vehicle.id,
        kind: normalizeKind(formData.get("kind"), file),
        url: null,
        pathname,
        filename: safeName,
        contentType: file.type || null,
        size: file.size,
      },
    });

    created.push({
      ...attachment,
      url: `/api/vehicles/${context.vehicle.id}/attachments/file?attachmentId=${attachment.id}`,
    });
  }

  await logActivity({
    workspaceId: context.workspace.id,
    actor: context.user.name,
    action: "vehicle_attachments_uploaded",
    entityType: "Vehicle",
    entityId: context.vehicle.id,
    metadata: {
      vehicleId: context.vehicle.id,
      plateNumber: context.vehicle.plateNumber,
      files: created.map((attachment) => attachment.filename),
    },
  });

  revalidateAttachmentSurfaces();
  return NextResponse.json({ attachments: created });
}
