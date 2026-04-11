import "server-only";

import { randomUUID } from "crypto";
import { mkdir, unlink, writeFile } from "fs/promises";
import path from "path";

type StoredListingPhoto = {
  mimeType: string;
  storagePath: string;
};

function getStorageRoot() {
  return process.env.LISTING_STORAGE_ROOT ?? path.join(process.cwd(), "data");
}

function resolveFileExtension(fileName: string, mimeType: string) {
  const extension = path.extname(fileName).toLowerCase();
  if (extension) return extension;

  switch (mimeType) {
    case "image/png":
      return ".png";
    case "image/webp":
      return ".webp";
    case "image/gif":
      return ".gif";
    case "image/jpeg":
    default:
      return ".jpg";
  }
}

export async function persistListingUploads(listingId: string, files: File[]) {
  const uploadDirectory = path.join(getStorageRoot(), "listing-media", listingId);
  await mkdir(uploadDirectory, { recursive: true });

  const storedPhotos: StoredListingPhoto[] = [];

  for (const file of files) {
    if (!(file instanceof File) || file.size === 0) {
      continue;
    }

    const mimeType = file.type || "image/jpeg";
    const extension = resolveFileExtension(file.name, mimeType);
    const storagePath = path.join(uploadDirectory, `${randomUUID()}${extension}`);
    const buffer = Buffer.from(await file.arrayBuffer());

    await writeFile(storagePath, buffer);
    storedPhotos.push({ mimeType, storagePath });
  }

  return storedPhotos;
}

export async function deleteListingPhotoAssets(photos: Array<{ storagePath: string }>) {
  await Promise.all(
    photos.map(async (photo) => {
      try {
        await unlink(photo.storagePath);
      } catch {
        // Ignore missing files so database cleanup can still succeed.
      }
    }),
  );
}
