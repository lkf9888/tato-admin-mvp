import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { isAdminAuthenticated } from "@/lib/auth";
import { logActivity } from "@/lib/orders";
import { prisma } from "@/lib/prisma";

function redirectToShareLinks(request: Request) {
  return NextResponse.redirect(new URL("/share-links", request.url), { status: 303 });
}

export async function POST(request: Request) {
  const authenticated = await isAdminAuthenticated();
  if (!authenticated) {
    return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
  }

  const formData = await request.formData();
  const id = formData.get("id")?.toString();
  if (!id) {
    return redirectToShareLinks(request);
  }

  const existing = await prisma.shareLink.findUnique({
    where: { id },
  });

  if (!existing) {
    return redirectToShareLinks(request);
  }

  await prisma.shareLink.delete({
    where: { id },
  });

  await logActivity({
    actor: "Admin",
    action: "share_link_deleted",
    entityType: "ShareLink",
    entityId: id,
  });

  ["/dashboard", "/share-links"].forEach((path) => revalidatePath(path));
  revalidatePath("/share/[token]", "page");

  return redirectToShareLinks(request);
}
