import { NextRequest, NextResponse } from "next/server";

import { requireCurrentAdminContext } from "@/lib/auth";
import { writeContractAuditLog } from "@/lib/contract-signing";
import { sendContractSigningEmail } from "@/lib/contract-email";
import { prisma } from "@/lib/prisma";
import { getWorkspaceMailIdentity } from "@/lib/site-sender";

type Params = Promise<{ id: string }>;

export async function GET(
  _req: NextRequest,
  { params }: { params: Params },
) {
  const { id } = await params;
  const { workspace } = await requireCurrentAdminContext();

  const envelope = await prisma.contractEnvelope.findFirst({
    where: { id, workspaceId: workspace.id },
    include: {
      template: { include: { fields: { orderBy: [{ page: "asc" }, { sortOrder: "asc" }] } } },
      order: {
        select: {
          id: true,
          renterName: true,
          pickupDatetime: true,
          returnDatetime: true,
          vehicle: { select: { plateNumber: true, nickname: true } },
        },
      },
      recipients: { orderBy: { signingOrder: "asc" } },
      values: true,
      auditLogs: {
        orderBy: { createdAt: "desc" },
        include: { recipient: { select: { name: true, email: true } } },
      },
    },
  });
  if (!envelope) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ envelope: serializeEnvelope(envelope) });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Params },
) {
  const { id } = await params;
  const { workspace } = await requireCurrentAdminContext();
  const body = await req.json().catch(() => null);
  if (body?.action === "resend") {
    return resendInvitation(req, id, workspace.id);
  }
  if (body?.action !== "void") {
    return NextResponse.json({ error: "Unsupported action." }, { status: 400 });
  }

  const envelope = await prisma.contractEnvelope.findFirst({
    where: { id, workspaceId: workspace.id },
    select: { id: true, status: true },
  });
  if (!envelope) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (envelope.status === "COMPLETED") {
    return NextResponse.json({ error: "Completed documents cannot be voided." }, { status: 400 });
  }

  const updated = await prisma.contractEnvelope.update({
    where: { id },
    data: { status: "VOIDED", voidedAt: new Date() },
    include: { recipients: true },
  });
  await writeContractAuditLog({
    workspaceId: workspace.id,
    envelopeId: id,
    event: "VOIDED",
    req,
  });
  return NextResponse.json({ envelope: updated });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Params },
) {
  const { id } = await params;
  const { workspace } = await requireCurrentAdminContext();

  const envelope = await prisma.contractEnvelope.findFirst({
    where: { id, workspaceId: workspace.id },
    select: { id: true },
  });
  if (!envelope) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.contractEnvelope.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

function serializeEnvelope<T extends {
  order?: {
    id: string;
    renterName: string | null;
    pickupDatetime: Date;
    returnDatetime: Date;
    vehicle: { plateNumber: string; nickname: string | null };
  } | null;
}>(envelope: T) {
  const { order, ...rest } = envelope;
  return {
    ...rest,
    booking: order
      ? {
          id: order.id,
          guestName: order.renterName,
          checkIn: order.pickupDatetime.toISOString(),
          checkOut: order.returnDatetime.toISOString(),
          property: {
            name: order.vehicle.plateNumber,
            nickname: order.vehicle.nickname,
          },
        }
      : null,
  };
}

/**
 * Send the signing invitation again to whoever's turn it is.
 *
 * The first email can fail -- the sending domain not verified, a typo
 * fixed since, an inbox that ate it -- and until now an envelope that
 * lost its invitation could only be voided and redone. The link is the
 * recipient's existing token; nothing about the envelope changes.
 */
async function resendInvitation(req: NextRequest, id: string, workspaceId: string) {
  const envelope = await prisma.contractEnvelope.findFirst({
    where: { id, workspaceId },
    include: { recipients: { orderBy: { signingOrder: "asc" } } },
  });
  if (!envelope) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (envelope.status === "COMPLETED" || envelope.status === "VOIDED") {
    return NextResponse.json({ error: "This document is no longer awaiting a signature." }, { status: 400 });
  }
  const recipient = envelope.recipients.find(
    (each) => each.status !== "SIGNED" && each.status !== "DECLINED",
  );
  if (!recipient) {
    return NextResponse.json({ error: "Nobody is waiting to sign." }, { status: 400 });
  }

  const origin = req.headers.get("origin") || new URL(req.url).origin;
  const publicBase = (process.env.APP_URL || origin).replace(/\/$/, "");
  const identity = await getWorkspaceMailIdentity(workspaceId);
  const result = await sendContractSigningEmail({
    to: recipient.email,
    recipientName: recipient.name,
    contractTitle: envelope.title,
    senderName: identity.brandName ?? "TATO",
    brandName: identity.brandName,
    from: identity.from,
    signingUrl: `${publicBase}/sign/${recipient.token}`,
    message: envelope.message,
  });

  await writeContractAuditLog({
    workspaceId,
    envelopeId: envelope.id,
    recipientId: recipient.id,
    event: result.ok ? "SENT" : "EMAIL_FAILED",
    req,
    metadata: result.ok ? { resent: true, to: recipient.email } : { resent: true, ...result },
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? result.status }, { status: 502 });
  }
  return NextResponse.json({ ok: true, to: recipient.email });
}
