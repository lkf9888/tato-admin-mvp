import { randomBytes } from "node:crypto";

import { NextResponse } from "next/server";

import { requireCurrentAdminContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type Params = Promise<{ orderId: string; attachmentId: string }>;

/**
 * Mint or revoke a public link for one attachment.
 *
 * A damage photo usually has to reach somebody without an account --
 * the renter disputing it, an adjuster, the owner of the car. The
 * alternative people actually use is downloading the file and sending
 * it by WeChat, which loses every connection to the trip it belongs
 * to.
 *
 * The token is the whole authorisation, so it is 256 bits of random
 * and it is per attachment: sharing one photo shares one photo, not
 * the order, not the car, and not the other files on it.
 */
export async function POST(_request: Request, { params }: { params: Params }) {
  const { orderId, attachmentId } = await params;
  const { workspace } = await requireCurrentAdminContext();

  const attachment = await prisma.orderAttachment.findFirst({
    where: { id: attachmentId, orderId, workspaceId: workspace.id, isArchived: false },
    select: { id: true, shareToken: true },
  });
  if (!attachment) {
    return NextResponse.json({ error: "ATTACHMENT_NOT_FOUND" }, { status: 404 });
  }

  // Already shared? Hand back the same link rather than rotating it.
  // Minting a new token on every click would silently break the link
  // somebody sent five minutes ago.
  if (attachment.shareToken) {
    return NextResponse.json({ token: attachment.shareToken });
  }

  const token = randomBytes(32).toString("base64url");
  await prisma.orderAttachment.update({
    where: { id: attachment.id },
    data: { shareToken: token, sharedAt: new Date() },
  });

  return NextResponse.json({ token });
}

/** Revoke. Every link already sent stops working. */
export async function DELETE(_request: Request, { params }: { params: Params }) {
  const { orderId, attachmentId } = await params;
  const { workspace } = await requireCurrentAdminContext();

  const attachment = await prisma.orderAttachment.findFirst({
    where: { id: attachmentId, orderId, workspaceId: workspace.id },
    select: { id: true },
  });
  if (!attachment) {
    return NextResponse.json({ error: "ATTACHMENT_NOT_FOUND" }, { status: 404 });
  }

  await prisma.orderAttachment.update({
    where: { id: attachment.id },
    data: { shareToken: null, sharedAt: null },
  });

  return NextResponse.json({ ok: true });
}
