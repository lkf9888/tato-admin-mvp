import "server-only";

import { randomBytes } from "crypto";
import { ShareVisibility } from "@prisma/client";

import { logActivity } from "@/lib/orders";
import { prisma } from "@/lib/prisma";

/**
 * The owner's read-only ledger link: the newest active one that has not
 * expired, or a new one when there is none.
 *
 * Shared by the "create share link" button and the statement email, so
 * an owner who already has a link keeps it -- an older email's link
 * stays valid -- and an email never goes out pointing at a link that
 * does not work.
 */
export async function ensureOwnerShareLink(input: {
  workspaceId: string;
  ownerId: string;
  createdBy: string;
}) {
  const existing = await prisma.shareLink.findFirst({
    where: {
      workspaceId: input.workspaceId,
      ownerId: input.ownerId,
      isActive: true,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    orderBy: { createdAt: "desc" },
  });
  if (existing) return { token: existing.token, created: false };

  const shareLink = await prisma.shareLink.create({
    data: {
      workspaceId: input.workspaceId,
      ownerId: input.ownerId,
      token: randomBytes(18).toString("hex"),
      visibility: ShareVisibility.standard,
      createdBy: input.createdBy,
    },
  });
  await logActivity({
    workspaceId: input.workspaceId,
    actor: input.createdBy,
    action: "share_link_created",
    entityType: "ShareLink",
    entityId: shareLink.id,
    metadata: { ownerId: input.ownerId, visibility: shareLink.visibility },
  });
  return { token: shareLink.token, created: true };
}
