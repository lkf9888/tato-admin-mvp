import { NextRequest, NextResponse } from "next/server";
import { sendContractCompletedEmail, sendContractSigningEmail } from "@/lib/contract-email";
import {
  renderSignedContractPdf,
  uploadSignedContractPdf,
  writeContractAuditLog,
  type ContractPdfField,
  type ContractPdfFieldValue,
} from "@/lib/contract-signing";
import { prisma } from "@/lib/prisma";

type Params = Promise<{ token: string }>;

export async function GET(
  req: NextRequest,
  { params }: { params: Params },
) {
  const { token } = await params;
  const recipient = await findRecipient(token);
  if (!recipient) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const availabilityError = envelopeAvailabilityError(recipient.envelope);
  if (availabilityError) {
    return NextResponse.json({ error: availabilityError }, { status: 400 });
  }
  const sequenceError = signingSequenceError(recipient);
  if (sequenceError) {
    return NextResponse.json({ error: sequenceError }, { status: 400 });
  }

  if (recipient.status === "PENDING") {
    await prisma.contractRecipient.update({
      where: { id: recipient.id },
      data: { status: "VIEWED", viewedAt: new Date() },
    });
    await writeContractAuditLog({
      workspaceId: recipient.envelope.workspaceId,
      envelopeId: recipient.envelope.id,
      recipientId: recipient.id,
      event: "VIEWED",
      req,
    });
  }

  return NextResponse.json({
    recipient: {
      id: recipient.id,
      name: recipient.name,
      email: recipient.email,
      signingOrder: recipient.signingOrder,
      status: recipient.status,
    },
    envelope: {
      id: recipient.envelope.id,
      title: recipient.envelope.title,
      message: recipient.envelope.message,
      status: recipient.envelope.status,
      expiresAt: recipient.envelope.expiresAt,
      signedPdfUrl: recipient.envelope.signedPdfUrl,
    },
    template: {
      name: recipient.envelope.template.name,
      pdfUrl: recipient.envelope.template.pdfUrl,
      pageCount: recipient.envelope.template.pageCount,
      pageSizes: recipient.envelope.template.pageSizes,
      fields: fieldsForRecipient(
        recipient.envelope.template.fields,
        recipient.signingOrder,
      ),
    },
    existingValues: recipient.envelope.values.filter(
      (value) => value.recipientId === recipient.id,
    ),
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Params },
) {
  const { token } = await params;
  const recipient = await findRecipient(token);
  if (!recipient) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const availabilityError = envelopeAvailabilityError(recipient.envelope);
  if (availabilityError) {
    return NextResponse.json({ error: availabilityError }, { status: 400 });
  }
  const sequenceError = signingSequenceError(recipient);
  if (sequenceError) {
    return NextResponse.json({ error: sequenceError }, { status: 400 });
  }
  if (recipient.status === "SIGNED") {
    return NextResponse.json({ error: "You already signed this document." }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const submitted = Array.isArray(body?.values) ? body.values : [];
  const allowedFields = fieldsForRecipient(
    recipient.envelope.template.fields,
    recipient.signingOrder,
  );
  const values = normalizeSubmittedValues(submitted, allowedFields);
  const error = validateRequiredFields(allowedFields, values);
  if (error) return NextResponse.json({ error }, { status: 400 });

  await prisma.$transaction(async (tx) => {
    for (const value of values) {
      await tx.contractFieldValue.upsert({
        where: {
          envelopeId_fieldId: {
            envelopeId: recipient.envelope.id,
            fieldId: value.fieldId,
          },
        },
        create: {
          envelopeId: recipient.envelope.id,
          fieldId: value.fieldId,
          recipientId: recipient.id,
          value: value.value,
          signature: value.signature,
          checked: value.checked,
        },
        update: {
          recipientId: recipient.id,
          value: value.value,
          signature: value.signature,
          checked: value.checked,
        },
      });
    }
    await tx.contractRecipient.update({
      where: { id: recipient.id },
      data: { status: "SIGNED", signedAt: new Date() },
    });
  });

  await writeContractAuditLog({
    workspaceId: recipient.envelope.workspaceId,
    envelopeId: recipient.envelope.id,
    recipientId: recipient.id,
    event: "SIGNED",
    req,
  });

  const fresh = await prisma.contractEnvelope.findUnique({
    where: { id: recipient.envelope.id },
    include: {
      workspace: { select: { users: { select: { email: true, name: true } } } },
      order: { select: { id: true, vehicleId: true, workspaceId: true } },
      template: { include: { fields: { orderBy: [{ page: "asc" }, { sortOrder: "asc" }] } } },
      recipients: { orderBy: { signingOrder: "asc" } },
      values: true,
    },
  });
  if (!fresh) return NextResponse.json({ ok: true });

  const allSigned = fresh.recipients.every((item) => item.status === "SIGNED");
  if (!allSigned) {
    await prisma.contractEnvelope.update({
      where: { id: fresh.id },
      data: { status: "PARTIALLY_SIGNED" },
    });
    const nextRecipient = fresh.recipients.find((item) => item.status !== "SIGNED");
    const emailFailures: { email: string; error: string }[] = [];
    if (nextRecipient) {
      const origin = req.headers.get("origin") || new URL(req.url).origin;
      const publicBase = (process.env.APP_URL || origin).replace(/\/$/, "");
      const result = await sendContractSigningEmail({
        to: nextRecipient.email,
        recipientName: nextRecipient.name,
        contractTitle: fresh.title,
        senderName: "TATO",
        signingUrl: `${publicBase}/sign/${nextRecipient.token}`,
        message: fresh.message,
      });
      if (result.ok) {
        await writeContractAuditLog({
          workspaceId: fresh.workspaceId,
          envelopeId: fresh.id,
          recipientId: nextRecipient.id,
          event: "SENT",
          req,
          metadata: { reason: "previous_signer_completed" },
        });
      } else {
        emailFailures.push({
          email: nextRecipient.email,
          error: result.error || result.status,
        });
        await writeContractAuditLog({
          workspaceId: fresh.workspaceId,
          envelopeId: fresh.id,
          recipientId: nextRecipient.id,
          event: "EMAIL_FAILED",
          req,
          metadata: result,
        });
      }
    }
    return NextResponse.json({ ok: true, completed: false, emailFailures });
  }

  const rendered = await renderSignedContractPdf({
    templatePdfUrl: fresh.template.pdfPathname,
    fields: fresh.template.fields.map(toPdfField),
    values: fresh.values.map(toPdfValue),
  });
  const blob = await uploadSignedContractPdf({
    envelopeId: fresh.id,
    title: fresh.title,
    buffer: rendered.buffer,
    baseUrl: getPublicBase(req),
  });
  const completedAt = new Date();
  const completed = await prisma.contractEnvelope.update({
    where: { id: fresh.id },
    data: {
      status: "COMPLETED",
      completedAt,
      signedPdfUrl: blob.url,
      signedPdfPathname: blob.pathname,
      signedPdfFilename: `${fresh.title} - signed.pdf`,
      signedPdfContentType: "application/pdf",
      signedPdfSize: rendered.buffer.length,
      signedPdfSha256: rendered.sha256,
    },
  });

  if (completed.orderId) {
    await prisma.orderAttachment.create({
      data: {
        workspaceId: fresh.workspaceId,
        orderId: completed.orderId,
        vehicleId: fresh.order?.vehicleId ?? null,
        kind: "document",
        url: blob.url,
        pathname: blob.pathname,
        filename: `${fresh.title} - signed.pdf`,
        contentType: "application/pdf",
        size: rendered.buffer.length,
      },
    });
  }

  await writeContractAuditLog({
    workspaceId: fresh.workspaceId,
    envelopeId: fresh.id,
    event: "PDF_GENERATED",
    req,
    metadata: { sha256: rendered.sha256, size: rendered.buffer.length },
  });
  await writeContractAuditLog({
    workspaceId: fresh.workspaceId,
    envelopeId: fresh.id,
    event: "COMPLETED",
    req,
  });

  const signedPdfAttachment = {
    filename: `${fresh.title} - signed.pdf`,
    content: rendered.buffer,
    contentType: "application/pdf",
  };
  for (const item of fresh.recipients) {
    // The signed-PDF route requires either an admin session or a valid
    // recipient token (see that route's header comment). Signers have
    // neither a session nor the bare URL, so carry their own token on
    // the link — it is the same secret that gated the signing page.
    const recipientPdfUrl = blob.url
      ? `${blob.url}?token=${encodeURIComponent(item.token)}`
      : blob.url;
    const result = await sendContractCompletedEmail({
      to: item.email,
      recipientName: item.name,
      contractTitle: fresh.title,
      signedPdfUrl: recipientPdfUrl,
      signedPdfAttachment,
    });
    if (!result.ok) {
      await writeContractAuditLog({
        workspaceId: fresh.workspaceId,
        envelopeId: fresh.id,
        recipientId: item.id,
        event: "EMAIL_FAILED",
        req,
        metadata: { email: item.email, status: result.status, error: result.error },
      });
    }
  }
  for (const admin of fresh.workspace?.users || []) {
    const hostEmailResult = await sendContractCompletedEmail({
      to: admin.email,
      recipientName: admin.name || "Admin",
      contractTitle: fresh.title,
      signedPdfUrl: blob.url,
      signedPdfAttachment,
    });
    if (!hostEmailResult.ok) {
      await writeContractAuditLog({
        workspaceId: fresh.workspaceId,
        envelopeId: fresh.id,
        event: "EMAIL_FAILED",
        req,
        metadata: { email: admin.email, status: hostEmailResult.status, error: hostEmailResult.error },
      });
    }
  }

  return NextResponse.json({
    ok: true,
    completed: true,
    signedPdfUrl: blob.url,
    sha256: rendered.sha256,
  });
}

async function findRecipient(token: string) {
  return prisma.contractRecipient.findUnique({
    where: { token },
    include: {
      envelope: {
        include: {
          template: {
            include: {
              fields: { orderBy: [{ page: "asc" }, { sortOrder: "asc" }] },
            },
          },
          values: true,
          recipients: { orderBy: { signingOrder: "asc" } },
        },
      },
    },
  });
}

function envelopeAvailabilityError(envelope: {
  status: string;
  expiresAt: Date | null;
}) {
  if (envelope.status === "VOIDED") return "This signing request has been voided.";
  if (envelope.status === "EXPIRED") return "This signing request has expired.";
  if (envelope.expiresAt && envelope.expiresAt.getTime() < Date.now()) {
    return "This signing request has expired.";
  }
  return null;
}

function signingSequenceError(recipient: {
  signingOrder: number;
  envelope: {
    recipients: Array<{ signingOrder: number; status: string }>;
  };
}) {
  const blockingSigner = recipient.envelope.recipients.find(
    (item) => item.signingOrder < recipient.signingOrder && item.status !== "SIGNED",
  );
  if (!blockingSigner) return null;
  return `This document is waiting for signer ${blockingSigner.signingOrder} to complete first.`;
}

function fieldsForRecipient<
  T extends { recipientIndex: number | null; required: boolean; type: string },
>(fields: T[], signingOrder: number) {
  return fields.filter((field) => {
    if (field.type === "REDACTION") return false;
    return field.recipientIndex == null
      ? signingOrder === 1
      : field.recipientIndex === signingOrder;
  });
}

function normalizeSubmittedValues(
  submitted: unknown[],
  fields: Array<{ id: string; type: string }>,
) {
  const allowed = new Map(fields.map((field) => [field.id, field]));
  return submitted
    .map((item) => {
      const record = typeof item === "object" && item ? item as Record<string, unknown> : {};
      const fieldId = typeof record.fieldId === "string" ? record.fieldId : "";
      const field = allowed.get(fieldId);
      if (!field) return null;
      return {
        fieldId,
        value: typeof record.value === "string" ? record.value.trim() || null : null,
        signature: typeof record.signature === "string" && record.signature.startsWith("data:image/")
          ? record.signature
          : null,
        checked: typeof record.checked === "boolean" ? record.checked : null,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);
}

function validateRequiredFields(
  fields: Array<{ id: string; label: string; type: string; required: boolean }>,
  values: ReturnType<typeof normalizeSubmittedValues>,
) {
  const byField = new Map(values.map((value) => [value.fieldId, value]));
  for (const field of fields) {
    if (field.type === "CHECKBOX") continue;
    if (!field.required) continue;
    const value = byField.get(field.id);
    if (field.type === "SIGNATURE" && !value?.signature && !value?.value) {
      return `${field.label} is required.`;
    }
    if (field.type !== "SIGNATURE" && !value?.value) {
      return `${field.label} is required.`;
    }
  }
  return null;
}

function toPdfField(field: {
  id: string;
  type: "SIGNATURE" | "TEXT" | "DATE" | "CHECKBOX" | "REDACTION";
  label: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number | null;
  defaultValue: string | null;
}): ContractPdfField {
  return field;
}

function toPdfValue(value: {
  fieldId: string;
  value: string | null;
  signature: string | null;
  checked: boolean | null;
}): ContractPdfFieldValue {
  return value;
}

function getPublicBase(req: NextRequest) {
  const origin = req.headers.get("origin") || new URL(req.url).origin;
  return (process.env.APP_URL || origin).replace(/\/$/, "");
}
