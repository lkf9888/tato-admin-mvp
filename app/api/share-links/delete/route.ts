import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { requireCurrentAdminContext } from "@/lib/auth";
import { logActivity } from "@/lib/orders";
import { prisma } from "@/lib/prisma";

function redirectToShareLinks(request: Request) {
  return NextResponse.redirect(new URL("/share-links", request.url), { status: 303 });
}

export async function POST(request: Request) {
  const { workspace, user } = await requireCurrentAdminContext();

  const formData = await request.formData();
  const id = formData.get("id")?.toString();
  if (!id) {
    return redirectToShareLinks(request);
  }

  const existing = await prisma.shareLink.findFirst({
    where: { id, workspaceId: workspace.id },
  });

  if (!existing) {
    return redirectToShareLinks(request);
  }

  await prisma.shareLink.delete({
    where: { id: existing.id },
  });

  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: "share_link_deleted",
    entityType: "ShareLink",
    entityId: id,
  });

  ["/dashboard", "/share-links"].forEach((path) => revalidatePath(path));
  revalidatePath("/share/[token]", "page");

  return redirectToShareLinks(request);
}
