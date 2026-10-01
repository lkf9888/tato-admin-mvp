import "server-only";

import { sendContractCompletedEmail, sendContractSigningEmail } from "@/lib/contract-email";
import {
  renderSignedContractPdf,
  uploadSignedContractPdf,
  writeContractAuditLog,
  type ContractPdfField,
  type ContractPdfFieldValue,
} from "@/lib/contract-signing";
import { prisma } from "@/lib/prisma";
import { getWorkspaceMailIdentity } from "@/lib/site-sender";

export type SubmittedFieldValue = {
  fieldId: string;
  value: string | null;
  signature: string | null;
  checked: boolean | null;
};

/**
 * Record one recipient's signature and, once every signer has signed,
 * finish the envelope: render the signed PDF, file it on the order, and
 * email it to the signers and the workspace.
 *
 * The one path for it, whether the renter signed on the signing page or
 * on the booking page before paying (v1.26.0) -- so a contract signed at
 * checkout is the same document, with the same audit trail, as one
 * signed from the emailed link.
 */
export async function completeRecipientSigning(input: {
  recipientId: string;
  values: SubmittedFieldValue[];
  /** Read from the request on the signing page; carried from checkout otherwise. */
  req?: Request;
  client?: { ip: string | null; userAgent: string | null };
  /** Where links in the emails point. */
  publicBase: string;
  auditMetadata?: Record<string, unknown>;
}): Promise<
  | { completed: false; emailFailures: { email: string; error: string }[] }
  | { completed: true; signedPdfUrl: string; sha256: string }
> {
  const recipient = await prisma.contractRecipient.findUniqueOrThrow({
    where: { id: input.recipientId },
    include: { envelope: { select: { id: true, workspaceId: true } } },
  });
  const envelopeId = recipient.envelope.id;
  const audit = { req: input.req, client: input.client };

  await prisma.$transaction(async (tx) => {
    for (const value of input.values) {
      await tx.contractFieldValue.upsert({
        where: { envelopeId_fieldId: { envelopeId, fieldId: value.fieldId } },
        create: {
          envelopeId,
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
    envelopeId,
    recipientId: recipient.id,
    event: "SIGNED",
    ...audit,
    metadata: input.auditMetadata,
  });

  const fresh = await prisma.contractEnvelope.findUnique({
    where: { id: envelopeId },
    include: {
      workspace: { select: { users: { select: { email: true, name: true } } } },
      order: { select: { id: true, vehicleId: true, workspaceId: true } },
      template: { include: { fields: { orderBy: [{ page: "asc" }, { sortOrder: "asc" }] } } },
      recipients: { orderBy: { signingOrder: "asc" } },
      values: true,
    },
  });
  if (!fresh) return { completed: false, emailFailures: [] };

  const allSigned = fresh.recipients.every((item) => item.status === "SIGNED");
  if (!allSigned) {
    await prisma.contractEnvelope.update({
      where: { id: fresh.id },
      data: { status: "PARTIALLY_SIGNED" },
    });
    const nextRecipient = fresh.recipients.find((item) => item.status !== "SIGNED");
    const emailFailures: { email: string; error: string }[] = [];
    if (nextRecipient) {
      const identity = await getWorkspaceMailIdentity(fresh.workspaceId);
      const result = await sendContractSigningEmail({
        to: nextRecipient.email,
        recipientName: nextRecipient.name,
        contractTitle: fresh.title,
        senderName: identity.brandName ?? "TATO",
        brandName: identity.brandName,
        from: identity.from,
        signingUrl: `${input.publicBase}/sign/${nextRecipient.token}`,
        message: fresh.message,
      });
      if (result.ok) {
        await writeContractAuditLog({
          workspaceId: fresh.workspaceId,
          envelopeId: fresh.id,
          recipientId: nextRecipient.id,
          event: "SENT",
          ...audit,
          metadata: { reason: "previous_signer_completed" },
        });
      } else {
        emailFailures.push({ email: nextRecipient.email, error: result.error || result.status });
        await writeContractAuditLog({
          workspaceId: fresh.workspaceId,
          envelopeId: fresh.id,
          recipientId: nextRecipient.id,
          event: "EMAIL_FAILED",
          ...audit,
          metadata: result,
        });
      }
    }
    return { completed: false, emailFailures };
  }

  const rendered = await renderSignedContractPdf({
    templatePdfUrl: fresh.template.pdfPathname,
    fields: fresh.template.fields.map((field): ContractPdfField => field),
    values: fresh.values.map((value): ContractPdfFieldValue => value),
  });
  const blob = await uploadSignedContractPdf({
    envelopeId: fresh.id,
    title: fresh.title,
    buffer: rendered.buffer,
    baseUrl: input.publicBase,
  });
  const completed = await prisma.contractEnvelope.update({
    where: { id: fresh.id },
    data: {
      status: "COMPLETED",
      completedAt: new Date(),
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
    ...audit,
    metadata: { sha256: rendered.sha256, size: rendered.buffer.length },
  });
  await writeContractAuditLog({
    workspaceId: fresh.workspaceId,
    envelopeId: fresh.id,
    event: "COMPLETED",
    ...audit,
  });

  const signedPdfAttachment = {
    filename: `${fresh.title} - signed.pdf`,
    content: rendered.buffer,
    contentType: "application/pdf",
  };
  const mailIdentity = await getWorkspaceMailIdentity(fresh.workspaceId);
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
      brandName: mailIdentity.brandName,
      from: mailIdentity.from,
    });
    if (!result.ok) {
      await writeContractAuditLog({
        workspaceId: fresh.workspaceId,
        envelopeId: fresh.id,
        recipientId: item.id,
        event: "EMAIL_FAILED",
        ...audit,
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
      // The operator's own copy carries their brand too, not ours.
      brandName: mailIdentity.brandName,
      from: mailIdentity.from,
    });
    if (!hostEmailResult.ok) {
      await writeContractAuditLog({
        workspaceId: fresh.workspaceId,
        envelopeId: fresh.id,
        event: "EMAIL_FAILED",
        ...audit,
        metadata: {
          email: admin.email,
          status: hostEmailResult.status,
          error: hostEmailResult.error,
        },
      });
    }
  }

  return { completed: true, signedPdfUrl: blob.url, sha256: rendered.sha256 };
}
