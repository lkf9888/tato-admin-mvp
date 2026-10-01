import { NextRequest, NextResponse } from "next/server";
import { completeRecipientSigning } from "@/lib/contract-completion";
import { writeContractAuditLog } from "@/lib/contract-signing";
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

  const result = await completeRecipientSigning({
    recipientId: recipient.id,
    values,
    req,
    publicBase: getPublicBase(req),
  });
  if (!result.completed) {
    return NextResponse.json({ ok: true, completed: false, emailFailures: result.emailFailures });
  }
  return NextResponse.json({
    ok: true,
    completed: true,
    signedPdfUrl: result.signedPdfUrl,
    sha256: result.sha256,
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

function getPublicBase(req: NextRequest) {
  const origin = req.headers.get("origin") || new URL(req.url).origin;
  return (process.env.APP_URL || origin).replace(/\/$/, "");
}
