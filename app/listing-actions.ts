"use server";

import { randomBytes } from "crypto";
import { ListingStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireAdminAuth } from "@/lib/auth";
import { deleteListingPhotoAssets, persistListingUploads } from "@/lib/listing-media";
import { getListingPath } from "@/lib/listings";
import { logActivity } from "@/lib/orders";
import { prisma } from "@/lib/prisma";

function emptyToUndefined(value: unknown) {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

const optionalText = z.preprocess(emptyToUndefined, z.string().optional());
const optionalNumber = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : value;
}, z.number().optional());
const optionalDate = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed ? new Date(`${trimmed}T12:00:00`) : undefined;
}, z.date().optional());
const optionalEmail = z.preprocess(emptyToUndefined, z.string().email().optional());

const listingSchema = z.object({
  id: z.preprocess(emptyToUndefined, z.string().optional()),
  title: z.string().trim().min(4),
  propertyType: z.string().trim().min(2),
  neighborhood: optionalText,
  addressLine: optionalText,
  city: z.string().trim().min(2),
  province: z.string().trim().min(2),
  monthlyRent: z.coerce.number().int().positive(),
  bedrooms: z.coerce.number().nonnegative(),
  bathrooms: z.coerce.number().nonnegative(),
  areaSqft: optionalNumber,
  availableFrom: optionalDate,
  summary: z.string().trim().min(16),
  description: z.string().trim().min(40),
  highlights: optionalText,
  amenities: optionalText,
  petPolicy: optionalText,
  parkingInfo: optionalText,
  furnishedInfo: optionalText,
  contactName: optionalText,
  contactPhone: optionalText,
  contactEmail: optionalEmail,
});

async function generatePublicId() {
  for (;;) {
    const publicId = randomBytes(6).toString("hex");
    const existing = await prisma.rentalListing.findUnique({
      where: { publicId },
      select: { id: true },
    });

    if (!existing) {
      return publicId;
    }
  }
}

function buildDashboardRedirect(listingId?: string, params?: string) {
  const suffix = params ? `${listingId ? "&" : "?"}${params}` : "";
  return listingId ? `/dashboard?listing=${listingId}${suffix}` : `/dashboard${suffix}`;
}

export async function saveRentalListingAction(formData: FormData) {
  await requireAdminAuth();

  const rawId = formData.get("id")?.toString().trim() ?? "";
  const redirectTarget = rawId ? buildDashboardRedirect(rawId) : "/dashboard";

  const parsed = listingSchema.safeParse({
    id: formData.get("id"),
    title: formData.get("title"),
    propertyType: formData.get("propertyType"),
    neighborhood: formData.get("neighborhood"),
    addressLine: formData.get("addressLine"),
    city: formData.get("city"),
    province: formData.get("province"),
    monthlyRent: formData.get("monthlyRent"),
    bedrooms: formData.get("bedrooms"),
    bathrooms: formData.get("bathrooms"),
    areaSqft: formData.get("areaSqft"),
    availableFrom: formData.get("availableFrom"),
    summary: formData.get("summary"),
    description: formData.get("description"),
    highlights: formData.get("highlights"),
    amenities: formData.get("amenities"),
    petPolicy: formData.get("petPolicy"),
    parkingInfo: formData.get("parkingInfo"),
    furnishedInfo: formData.get("furnishedInfo"),
    contactName: formData.get("contactName"),
    contactPhone: formData.get("contactPhone"),
    contactEmail: formData.get("contactEmail"),
  });

  if (!parsed.success) {
    redirect(`${redirectTarget}${redirectTarget.includes("?") ? "&" : "?"}error=invalid`);
  }

  const intent = formData.get("intent")?.toString() === "publish" ? "publish" : "draft";
  const nextStatus = intent === "publish" ? ListingStatus.published : ListingStatus.draft;
  const removePhotoIds = formData
    .getAll("removePhotoIds")
    .map((value) => value.toString())
    .filter(Boolean);
  const newPhotos = formData
    .getAll("newPhotos")
    .filter((value): value is File => value instanceof File && value.size > 0);

  const { id, ...listingInput } = parsed.data;
  const existingListing = id
    ? await prisma.rentalListing.findUnique({
        where: { id },
        include: { photos: true },
      })
    : null;

  if (id && !existingListing) {
    redirect("/dashboard?error=missing");
  }

  const listing = id
    ? await prisma.rentalListing.update({
        where: { id },
        data: {
          ...listingInput,
          status: nextStatus,
          publishedAt: nextStatus === ListingStatus.published ? existingListing?.publishedAt ?? new Date() : null,
        },
      })
    : await prisma.rentalListing.create({
        data: {
          ...listingInput,
          publicId: await generatePublicId(),
          status: nextStatus,
          publishedAt: nextStatus === ListingStatus.published ? new Date() : null,
        },
      });

  if (removePhotoIds.length > 0) {
    const photosToDelete = await prisma.listingPhoto.findMany({
      where: {
        id: { in: removePhotoIds },
        listingId: listing.id,
      },
    });

    await deleteListingPhotoAssets(photosToDelete);
    await prisma.listingPhoto.deleteMany({
      where: {
        id: { in: photosToDelete.map((photo) => photo.id) },
      },
    });
  }

  if (newPhotos.length > 0) {
    const storedPhotos = await persistListingUploads(listing.id, newPhotos);
    const existingPhotoCount = await prisma.listingPhoto.count({
      where: { listingId: listing.id },
    });

    if (storedPhotos.length > 0) {
      await prisma.listingPhoto.createMany({
        data: storedPhotos.map((photo, index) => ({
          listingId: listing.id,
          storagePath: photo.storagePath,
          mimeType: photo.mimeType,
          sortOrder: existingPhotoCount + index,
        })),
      });
    }
  }

  await logActivity({
    actor: "Admin",
    action: id ? "listing_updated" : "listing_created",
    entityType: "RentalListing",
    entityId: listing.id,
    metadata: {
      title: listing.title,
      status: nextStatus,
    },
  });

  revalidatePath("/dashboard");
  revalidatePath(getListingPath(listing.publicId));
  redirect(buildDashboardRedirect(listing.id, `saved=${intent}`));
}

export async function deleteRentalListingAction(formData: FormData) {
  await requireAdminAuth();

  const listingId = formData.get("id")?.toString();
  if (!listingId) {
    redirect("/dashboard?error=missing");
  }

  const listing = await prisma.rentalListing.findUnique({
    where: { id: listingId },
    include: { photos: true },
  });

  if (!listing) {
    redirect("/dashboard?error=missing");
  }

  await deleteListingPhotoAssets(listing.photos);
  await prisma.rentalListing.delete({
    where: { id: listingId },
  });

  await logActivity({
    actor: "Admin",
    action: "listing_deleted",
    entityType: "RentalListing",
    entityId: listingId,
    metadata: { title: listing.title },
  });

  revalidatePath("/dashboard");
  revalidatePath(getListingPath(listing.publicId));
  redirect("/dashboard?deleted=1");
}
