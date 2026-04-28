import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { requireCurrentAdminContext } from "@/lib/auth";
import { logActivity } from "@/lib/orders";
import { prisma } from "@/lib/prisma";

function redirectTo(request: Request, pathname: string) {
  return NextResponse.redirect(new URL(pathname, request.url), { status: 303 });
}

function revalidateSharePages() {
  ["/dashboard", "/share-links"].forEach((path) => revalidatePath(path));
  revalidatePath("/share/[token]", "page");
}

export async function POST(request: Request) {
  const { workspace, user } = await requireCurrentAdminContext();

  const formData = await request.formData();
  const id = formData.get("id")?.toString();
  if (!id) {
    return redirectTo(request, "/share-links");
  }

  const existing = await prisma.shareLink.findFirst({
    where: { id, workspaceId: workspace.id },
  });

  if (!existing) {
    return redirectTo(request, "/share-links");
  }

  await prisma.shareLink.update({
    where: { id: existing.id },
    data: { isActive: false },
  });

  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: "share_link_revoked",
    entityType: "ShareLink",
    entityId: id,
  });

  revalidateSharePages();

  return redirectTo(request, "/share-links");
}
