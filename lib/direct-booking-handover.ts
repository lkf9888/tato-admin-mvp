import "server-only";

import { createHash } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";

import { getBookingPolicyForVehicle } from "@/lib/booking-policy-server";
import { verifyUpload } from "@/lib/inspection-evidence";
import { prisma } from "@/lib/prisma";
import { makeDirectBookingDocumentPath, resolveUploadPath, sanitizeFilename } from "@/lib/uploads";

/**
 * Handover evidence on a direct booking: photos at pickup and return,
 * from the renter (on their booking page) and from the operator (on
 * the order), plus the operator's odometer and fuel readings.
 *
 * Like Turo's check-in: both sides photograph the car when it changes
 * hands, so a scratch found later can be placed before or after the
 * trip. Photos are kept exactly as uploaded -- recompressing would
 * strip the EXIF that dates them -- and what the server could read
 * from them (capture time, location) is stored next to them.
 */

export const HANDOVER_STAGES = ["pickup", "return"] as const;
export type HandoverStage = (typeof HANDOVER_STAGES)[number];
export const HANDOVER_PARTIES = ["renter", "operator"] as const;
export type HandoverParty = (typeof HANDOVER_PARTIES)[number];

export const MAX_HANDOVER_PHOTO_BYTES = 25 * 1024 * 1024;
export const MAX_HANDOVER_PHOTOS = 40;

export function isHandoverStage(value: unknown): value is HandoverStage {
  return value === "pickup" || value === "return";
}

export type HandoverPhotoView = {
  id: string;
  filename: string;
  capturedAt: string | null;
  hasLocation: boolean;
  uploadedAt: string;
};

export type HandoverSideView = {
  odometerKm: number | null;
  fuelLevel: string | null;
  note: string | null;
  photos: HandoverPhotoView[];
};

export type HandoverView = Record<HandoverStage, Record<HandoverParty, HandoverSideView>>;

const EMPTY_SIDE: HandoverSideView = { odometerKm: null, fuelLevel: null, note: null, photos: [] };

export async function loadHandovers(orderId: string): Promise<HandoverView> {
  const rows = await prisma.tripHandover.findMany({
    where: { orderId },
    include: { photos: { orderBy: { uploadedAt: "asc" } } },
  });
  const view: HandoverView = {
    pickup: { renter: { ...EMPTY_SIDE }, operator: { ...EMPTY_SIDE } },
    return: { renter: { ...EMPTY_SIDE }, operator: { ...EMPTY_SIDE } },
  };
  for (const row of rows) {
    if (!isHandoverStage(row.stage) || (row.party !== "renter" && row.party !== "operator")) continue;
    view[row.stage][row.party] = {
      odometerKm: row.odometerKm,
      fuelLevel: row.fuelLevel,
      note: row.note,
      photos: row.photos.map((photo) => ({
        id: photo.id,
        filename: photo.filename,
        capturedAt: photo.capturedAt?.toISOString() ?? null,
        hasLocation: photo.latitude != null && photo.longitude != null,
        uploadedAt: photo.uploadedAt.toISOString(),
      })),
    };
  }
  return view;
}

async function ensureHandover(input: {
  workspaceId: string;
  orderId: string;
  stage: HandoverStage;
  party: HandoverParty;
}) {
  return prisma.tripHandover.upsert({
    where: { orderId_stage_party: { orderId: input.orderId, stage: input.stage, party: input.party } },
    update: {},
    create: { workspaceId: input.workspaceId, orderId: input.orderId, stage: input.stage, party: input.party },
    include: { _count: { select: { photos: true } } },
  });
}

export type StorePhotoResult =
  | { ok: true; photo: HandoverPhotoView }
  | { ok: false; error: "NOT_AN_IMAGE" | "TOO_LARGE" | "TOO_MANY" | "EMPTY" };

/**
 * Keep one photograph. Any image is accepted -- a renter's browser may
 * strip the capture time or location, and a photo without them is still
 * the only picture of that bumper on that day -- but whatever EXIF it
 * does carry is read and stored.
 */
export async function storeHandoverPhoto(input: {
  workspaceId: string;
  orderId: string;
  stage: HandoverStage;
  party: HandoverParty;
  file: File;
  uploadedBy: string;
}): Promise<StorePhotoResult> {
  const { file } = input;
  if (file.size <= 0) return { ok: false, error: "EMPTY" };
  if (file.size > MAX_HANDOVER_PHOTO_BYTES) return { ok: false, error: "TOO_LARGE" };
  const isImage =
    file.type.startsWith("image/") || /\.(jpe?g|png|heic|heif|webp)$/i.test(file.name);
  if (!isImage) return { ok: false, error: "NOT_AN_IMAGE" };

  const handover = await ensureHandover(input);
  if (handover._count.photos >= MAX_HANDOVER_PHOTOS) return { ok: false, error: "TOO_MANY" };

  const bytes = Buffer.from(await file.arrayBuffer());
  // Walkaround's reader, used for its facts only: it refuses files a
  // staff camera would never produce, which a renter's browser may.
  const verified = verifyUpload({ bytes });
  const facts = verified.ok ? verified.result.facts : null;
  const sha256 = verified.ok
    ? verified.result.sha256
    : createHash("sha256").update(bytes).digest("hex");

  const filename = sanitizeFilename(file.name || `${input.stage}.jpg`);
  const pathname = makeDirectBookingDocumentPath(
    `handover-${input.orderId}`,
    `${input.stage}-${input.party}`,
    filename,
  );
  const absolute = resolveUploadPath(pathname);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, bytes);

  const photo = await prisma.tripHandoverPhoto.create({
    data: {
      handoverId: handover.id,
      pathname,
      filename,
      contentType: file.type || "image/jpeg",
      size: bytes.length,
      sha256,
      capturedAt: facts?.capturedAt ?? null,
      latitude: facts?.latitude ?? null,
      longitude: facts?.longitude ?? null,
      uploadedBy: input.uploadedBy,
    },
  });
  return {
    ok: true,
    photo: {
      id: photo.id,
      filename: photo.filename,
      capturedAt: photo.capturedAt?.toISOString() ?? null,
      hasLocation: photo.latitude != null && photo.longitude != null,
      uploadedAt: photo.uploadedAt.toISOString(),
    },
  };
}

/** The operator's readings for one handover. */
export async function saveOperatorReadings(input: {
  workspaceId: string;
  orderId: string;
  stage: HandoverStage;
  odometerKm: number | null;
  fuelLevel: string | null;
  note: string | null;
  updatedBy: string;
}) {
  await ensureHandover({ ...input, party: "operator" });
  await prisma.tripHandover.update({
    where: { orderId_stage_party: { orderId: input.orderId, stage: input.stage, party: "operator" } },
    data: {
      odometerKm: input.odometerKm,
      fuelLevel: input.fuelLevel,
      note: input.note,
      updatedBy: input.updatedBy,
    },
  });
}

/** A photo, with the order it belongs to, for whoever is allowed to see it. */
export async function findHandoverPhoto(photoId: string) {
  return prisma.tripHandoverPhoto.findUnique({
    where: { id: photoId },
    include: { handover: { select: { orderId: true, workspaceId: true, party: true } } },
  });
}

/**
 * Distance driven and what it allows, from the operator's two odometer
 * readings and the car's terms. Null until both readings exist.
 */
export async function summarizeMileage(input: {
  view: HandoverView;
  vehicle: Parameters<typeof getBookingPolicyForVehicle>[0];
  chargedDays: number | null;
}) {
  const start = input.view.pickup.operator.odometerKm;
  const end = input.view.return.operator.odometerKm;
  if (start == null || end == null) return null;
  const policy = await getBookingPolicyForVehicle(input.vehicle);
  const driven = Math.max(0, end - start);
  const allowance =
    input.chargedDays && policy.dailyKmAllowance > 0
      ? policy.dailyKmAllowance * input.chargedDays
      : null;
  const excess = allowance != null ? Math.max(0, driven - allowance) : 0;
  return {
    driven,
    allowance,
    excess,
    excessRate: policy.extraKmRate,
    excessAmount: Math.round(excess * policy.extraKmRate * 100) / 100,
  };
}
