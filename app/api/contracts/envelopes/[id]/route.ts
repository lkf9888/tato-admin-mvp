import { NextRequest, NextResponse } from "next/server";

import { requireCurrentAdminContext } from "@/lib/auth";
import { writeContractAuditLog } from "@/lib/contract-signing";
import { prisma } from "@/lib/prisma";

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
