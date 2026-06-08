import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";

import { requireCurrentAdminContext } from "@/lib/auth";
import { sendContractSigningEmail } from "@/lib/contract-email";
import { writeContractAuditLog } from "@/lib/contract-signing";
import { prisma } from "@/lib/prisma";

type RecipientInput = {
  name: string;
  email: string;
};

export async function GET() {
  const { workspace } = await requireCurrentAdminContext();

  const envelopes = await prisma.contractEnvelope.findMany({
    where: { workspaceId: workspace.id },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      template: { select: { id: true, name: true } },
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
    },
  });
  return NextResponse.json({ envelopes: envelopes.map(serializeEnvelope) });
}

export async function POST(req: NextRequest) {
  const { workspace, user } = await requireCurrentAdminContext();
  const body = await req.json().catch(() => null);
  const templateId = clean(body?.templateId);
  const title = clean(body?.title);
  const submittedRecipients = parseRecipients(body?.recipients);
  if (!templateId || !title) {
    return NextResponse.json(
      { error: "Template and title are required." },
      { status: 400 },
    );
  }

  const template = await prisma.contractTemplate.findFirst({
    where: { id: templateId, workspaceId: workspace.id, active: true },
    include: {
      fields: true,
      recipients: { orderBy: { signingOrder: "asc" } },
    },
  });
  if (!template) return NextResponse.json({ error: "Template not found." }, { status: 404 });
  if (template.fields.length === 0) {
    return NextResponse.json(
      { error: "Add at least one signing field before sending." },
      { status: 400 },
    );
  }
  const recipients = submittedRecipients.length
    ? submittedRecipients
    : template.recipients.map((recipient) => ({
        name: recipient.name,
        email: recipient.email,
      }));
  if (recipients.length === 0) {
    return NextResponse.json(
      { error: "At least one recipient is required." },
      { status: 400 },
    );
  }

  const orderId = clean(body?.orderId) || clean(body?.bookingId);
  if (orderId) {
    const order = await prisma.order.findFirst({
      where: { id: orderId, workspaceId: workspace.id, isArchived: false },
      select: { id: true },
    });
    if (!order) return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }

  const publicBase = getPublicBase(req);
  const expiresAt = toExpiry(body?.expiresInDays);

  const envelope = await prisma.contractEnvelope.create({
    data: {
      workspaceId: workspace.id,
      templateId,
      orderId,
      title,
      message: clean(body?.message),
      status: "SENT",
      sentAt: new Date(),
      expiresAt,
      recipients: {
        create: recipients.map((recipient, index) => ({
          name: recipient.name,
          email: recipient.email,
          signingOrder: index + 1,
          token: randomToken(),
        })),
      },
    },
    include: {
      template: { select: { id: true, name: true } },
      recipients: { orderBy: { signingOrder: "asc" } },
      order: {
        select: {
          id: true,
          renterName: true,
          pickupDatetime: true,
          returnDatetime: true,
          vehicle: { select: { plateNumber: true, nickname: true } },
        },
      },
    },
  });
  await writeContractAuditLog({
    workspaceId: workspace.id,
    envelopeId: envelope.id,
    event: "CREATED",
    req,
  });
  await writeContractAuditLog({
    workspaceId: workspace.id,
    envelopeId: envelope.id,
    event: "SENT",
    req,
    metadata: { recipientCount: envelope.recipients.length },
  });

  const emailFailures: { email: string; error: string }[] = [];
  const firstRecipient = envelope.recipients[0];
  if (firstRecipient) {
    const signingUrl = `${publicBase}/sign/${firstRecipient.token}`;
    const result = await sendContractSigningEmail({
      to: firstRecipient.email,
      recipientName: firstRecipient.name,
      contractTitle: envelope.title,
      senderName: user.name,
      signingUrl,
      message: envelope.message,
    });
    if (!result.ok) {
      emailFailures.push({
        email: firstRecipient.email,
        error: result.error || result.status,
      });
      await writeContractAuditLog({
        workspaceId: workspace.id,
        envelopeId: envelope.id,
        recipientId: firstRecipient.id,
        event: "EMAIL_FAILED",
        req,
        metadata: result,
      });
    }
  }

  return NextResponse.json({ envelope: serializeEnvelope(envelope), emailFailures });
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

function parseRecipients(value: unknown): RecipientInput[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const record = typeof item === "object" && item ? item as Record<string, unknown> : {};
      return { name: clean(record.name) || "", email: clean(record.email) || "" };
    })
    .filter((item) => item.name && isEmail(item.email));
}

function clean(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function randomToken() {
  return randomBytes(24).toString("base64url");
}

function toExpiry(value: unknown) {
  const days = Number(value);
  if (!Number.isFinite(days) || days <= 0) return null;
  return new Date(Date.now() + Math.min(days, 365) * 24 * 60 * 60 * 1000);
}

function getPublicBase(req: NextRequest) {
  const origin = req.headers.get("origin") || new URL(req.url).origin;
  return (process.env.APP_URL || origin).replace(/\/$/, "");
}
