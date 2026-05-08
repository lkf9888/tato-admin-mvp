import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { requireCurrentAdminContext } from "@/lib/auth";
import { logActivity } from "@/lib/orders";
import { prisma } from "@/lib/prisma";

function redirectToOwners(request: Request) {
  return NextResponse.redirect(new URL("/owners", request.url), { status: 303 });
}

export async function POST(request: Request) {
  const { workspace, user } = await requireCurrentAdminContext();

  const formData = await request.formData();
  const id = formData.get("id")?.toString();
  if (!id) {
    return redirectToOwners(request);
  }

  const existing = await prisma.shareLink.findFirst({
    where: { id, workspaceId: workspace.id },
  });

  if (!existing) {
    return redirectToOwners(request);
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

  ["/dashboard", "/owners", "/share-links"].forEach((path) => revalidatePath(path));
  revalidatePath("/share/[token]", "page");

  return redirectToOwners(request);
}
