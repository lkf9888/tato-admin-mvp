import { readFile } from "fs/promises";

import { prisma } from "@/lib/prisma";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ photoId: string }> },
) {
  const { photoId } = await params;
  const photo = await prisma.listingPhoto.findUnique({
    where: { id: photoId },
  });

  if (!photo) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const file = await readFile(photo.storagePath);
    return new Response(file, {
      headers: {
        "Content-Type": photo.mimeType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
