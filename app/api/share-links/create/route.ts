import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { ShareVisibility } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { requireCurrentAdminContext } from "@/lib/auth";
import { logActivity } from "@/lib/orders";
import { prisma } from "@/lib/prisma";

function redirectTo(request: Request, pathname: string) {
  return NextResponse.redirect(new URL(pathname, request.url), { status: 303 });
}

function cleanOptional(value: FormDataEntryValue | null) {
  if (!value) return undefined;
  const stringValue = value.toString().trim();
  return stringValue ? stringValue : undefined;
}

function revalidateSharePages() {
  ["/dashboard", "/share-links"].forEach((path) => revalidatePath(path));
  revalidatePath("/share/[token]", "page");
}

export async function POST(request: Request) {
  const { workspace, user } = await requireCurrentAdminContext();

  const formData = await request.formData();
  const ownerId = formData.get("ownerId")?.toString();
  if (!ownerId) {
    return redirectTo(request, "/share-links");
  }

  const password = cleanOptional(formData.get("password"));
  const expiresAtValue = cleanOptional(formData.get("expiresAt"));
  const requestedVisibility = formData.get("visibility")?.toString();
  const visibility = Object.values(ShareVisibility).includes(requestedVisibility as ShareVisibility)
    ? (requestedVisibility as ShareVisibility)
    : ShareVisibility.standard;

  const owner = await prisma.owner.findFirst({
    where: { id: ownerId, workspaceId: workspace.id },
    select: { id: true },
  });

  if (!owner) {
    return redirectTo(request, "/share-links");
  }

  const shareLink = await prisma.shareLink.create({
    data: {
      workspaceId: workspace.id,
      ownerId: owner.id,
      token: randomBytes(18).toString("hex"),
      passwordHash: password ? await bcrypt.hash(password, 10) : undefined,
      expiresAt: expiresAtValue ? new Date(expiresAtValue) : undefined,
      visibility,
      createdBy: user.name,
    },
  });

  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: "share_link_created",
    entityType: "ShareLink",
    entityId: shareLink.id,
    metadata: { ownerId, visibility },
  });

  revalidateSharePages();

  return redirectTo(request, "/share-links");
}
