import "server-only";

import { randomBytes } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import type { ContractFieldType } from "@prisma/client";

import { logActivity } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import {
  renderRentalAgreementTemplatePdf,
  type RentalAgreementField,
  type RentalAgreementFieldKey,
} from "@/lib/rental-agreement-pdf";
import { RENTAL_AGREEMENT_DEFAULT_OWNER_ADDRESS } from "@/lib/rental-agreement-text";
import { sendContractSigningEmail } from "@/lib/contract-email";
import { writeContractAuditLog } from "@/lib/contract-signing";
import { makeContractTemplatePdfPath, resolveUploadPath } from "@/lib/uploads";
import { formatCurrency } from "@/lib/utils";

/**
 * The rental agreement, from paper template to a signed PDF.
 *
 * One template per workspace, reused by every booking. The booking's
 * own facts are not baked into it -- they arrive as pre-filled field
 * values on each envelope, addressed to a signing order no recipient
 * holds, so they print on the contract while staying out of reach of
 * the person signing it. A renter who could retype the rental price
 * before signing is the failure this arrangement exists to prevent.
 */

export const RENTAL_AGREEMENT_TEMPLATE_NAME = "Car Sharing Agreement";

function randomToken() {
  return randomBytes(24).toString("hex");
}

/**
 * Find or build this workspace's agreement template.
 *
 * Idempotent, and deliberately does not rewrite an existing one: once
 * an operator has edited a clause or moved a box, regenerating from
 * our defaults would throw their work away. A workspace that wants the
 * template back deletes it and lets this run again.
 */
export async function ensureRentalAgreementTemplate(workspaceId: string) {
  const existing = await prisma.contractTemplate.findFirst({
    where: { workspaceId, name: RENTAL_AGREEMENT_TEMPLATE_NAME, active: true },
    include: { fields: true },
  });
  if (existing && existing.fields.length > 0) return existing;

  // A template with no fields is a half-built one: the row is created
  // before the PDF is written, so a crash in between leaves a record
  // no envelope can be sent from. Clearing it keeps a retry from
  // stacking a second dead template on top of the first. The delete is
  // allowed to fail -- if something did manage to reference it, the
  // create below is still the right next step.
  if (existing) {
    await prisma.contractTemplate
      .delete({ where: { id: existing.id } })
      .catch(() => undefined);
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { name: true },
  });
  const site = await prisma.rentalSite.findUnique({
    where: { workspaceId },
    select: { brandName: true, contactAddress: true },
  });

  const ownerName = site?.brandName?.trim() || workspace?.name?.trim() || "Owner";
  const ownerAddress =
    site?.contactAddress?.trim() || RENTAL_AGREEMENT_DEFAULT_OWNER_ADDRESS;

  const rendered = await renderRentalAgreementTemplatePdf({ ownerName, ownerAddress });

  const template = await prisma.contractTemplate.create({
    data: {
      workspaceId,
      name: RENTAL_AGREEMENT_TEMPLATE_NAME,
      description: "Generated from the paper car sharing agreement.",
      // Filled in below: the pathname needs the template id, which the
      // row has to exist to have.
      pdfUrl: "",
      pdfPathname: "",
      sourceType: "PDF",
      pageCount: rendered.pageSizes.length,
      pageSizes: rendered.pageSizes,
    },
  });

  const pathname = makeContractTemplatePdfPath(template.id, "car-sharing-agreement.pdf");
  const absolutePath = resolveUploadPath(pathname);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, rendered.buffer);

  await prisma.contractTemplate.update({
    where: { id: template.id },
    data: {
      pdfPathname: pathname,
      pdfUrl: `/api/contracts/templates/${template.id}/file?kind=pdf`,
      pdfFilename: "car-sharing-agreement.pdf",
      pdfContentType: "application/pdf",
      pdfSize: rendered.buffer.length,
    },
  });

  await prisma.contractTemplateField.createMany({
    data: rendered.fields.map((field: RentalAgreementField, index: number) => ({
      templateId: template.id,
      type: field.type as ContractFieldType,
      label: field.label,
      required: field.required,
      recipientIndex: field.recipientIndex,
      page: field.page,
      x: field.x,
      y: field.y,
      width: field.width,
      height: field.height,
      fontSize: field.type === "SIGNATURE" ? 18 : 10,
      sortOrder: index,
    })),
  });

  await logActivity({
    workspaceId,
    actor: "system",
    action: "rental_agreement_template_created",
    entityType: "ContractTemplate",
    entityId: template.id,
    metadata: { pages: rendered.pageSizes.length, fields: rendered.fields.length },
  });

  return prisma.contractTemplate.findUniqueOrThrow({
    where: { id: template.id },
    include: { fields: true },
  });
}

/** What the contract states about one booking. Blank stays blank. */
export type RentalAgreementValues = Partial<Record<RentalAgreementFieldKey, string>>;

function toDisplayDate(value: Date) {
  return value.toISOString().slice(0, 10).replace(/-/g, "/");
}

export function buildRentalAgreementValues(input: {
  renterName: string;
  renterPhone?: string | null;
  renterEmail?: string | null;
  vehicle: { brand: string; model: string; year: number; plateNumber: string; vin?: string | null };
  pickupDatetime: Date;
  returnDatetime: Date;
  totalPrice?: number | null;
  depositAmount?: number | null;
  insuranceAmount?: number | null;
  paymentMethodOnFile?: string | null;
}): RentalAgreementValues {
  return {
    renterName: input.renterName,
    renterPhone: input.renterPhone?.trim() || "",
    renterEmail: input.renterEmail?.trim() || "",
    vehicle: `${input.vehicle.year} ${input.vehicle.brand} ${input.vehicle.model}`,
    licensePlate: input.vehicle.plateNumber,
    vehicleVin: input.vehicle.vin?.trim() || "",
    rentalStartDate: toDisplayDate(input.pickupDatetime),
    rentalEndDate: toDisplayDate(input.returnDatetime),
    // Read off the odometer at handover, so it is left for a person.
    beginningMileage: "",
    fuelLevel: "100%",
    rentalPrice: input.totalPrice != null ? formatCurrency(input.totalPrice) : "",
    securityDeposit:
      input.depositAmount != null && input.depositAmount > 0
        ? formatCurrency(input.depositAmount)
        : "",
    insuranceFee:
      input.insuranceAmount != null && input.insuranceAmount > 0
        ? formatCurrency(input.insuranceAmount)
        : "",
    paymentMethodOnFile: input.paymentMethodOnFile?.trim() || "",
  };
}

/**
 * Send the agreement to a renter for signature.
 *
 * Returns null rather than throwing on any failure. It is called from
 * the Stripe webhook after the order exists and the host has been
 * paid: a contract that could not be sent is something to chase, not a
 * reason to fail the webhook and have Stripe retry a completed
 * booking.
 */
export async function createRentalAgreementEnvelope(input: {
  workspaceId: string;
  orderId: string;
  renterName: string;
  renterEmail: string | null;
  values: RentalAgreementValues;
  appUrl: string;
  /** The operator's own name, for the renter-facing email. */
  brandName?: string | null;
}) {
  try {
    const to = input.renterEmail?.trim();
    if (!to) return null;

    const existing = await prisma.contractEnvelope.findFirst({
      where: { orderId: input.orderId, status: { not: "VOIDED" } },
      select: { id: true },
    });
    if (existing) return existing;

    const template = await ensureRentalAgreementTemplate(input.workspaceId);

    const site = await prisma.rentalSite.findUnique({
      where: { workspaceId: input.workspaceId },
      select: { brandName: true },
    });
    const brandName =
      input.brandName?.trim() || site?.brandName?.trim() || null;

    const envelope = await prisma.contractEnvelope.create({
      data: {
        workspaceId: input.workspaceId,
        templateId: template.id,
        orderId: input.orderId,
        title: `${RENTAL_AGREEMENT_TEMPLATE_NAME} — ${input.renterName}`,
        status: "SENT",
        sentAt: new Date(),
        recipients: {
          create: [
            { name: input.renterName, email: to, signingOrder: 1, token: randomToken() },
          ],
        },
      },
      include: { recipients: true },
    });

    // Pre-filled facts, with no recipient attached. The signing page
    // only hands a recipient their own values, so these render into the
    // final PDF without ever being offered to the renter for editing.
    const fieldsByLabel = new Map(template.fields.map((field) => [field.label, field]));
    const valueRows = Object.entries(input.values).flatMap(([key, value]) => {
      if (!value) return [];
      const field = fieldsByLabel.get(labelFor(key));
      if (!field) return [];
      return [{ envelopeId: envelope.id, fieldId: field.id, value }];
    });

    if (valueRows.length > 0) {
      await prisma.contractFieldValue.createMany({ data: valueRows });
    }

    const recipient = envelope.recipients[0];
    const result = await sendContractSigningEmail({
      to,
      recipientName: input.renterName,
      contractTitle: envelope.title,
      senderName: brandName,
      brandName,
      signingUrl: `${input.appUrl.replace(/\/$/, "")}/sign/${recipient.token}`,
      message: null,
    });

    await writeContractAuditLog({
      workspaceId: input.workspaceId,
      envelopeId: envelope.id,
      recipientId: recipient.id,
      event: result.ok ? "SENT" : "EMAIL_FAILED",
      metadata: { reason: "direct_booking" },
    });

    await logActivity({
      workspaceId: input.workspaceId,
      actor: "direct-booking",
      action: result.ok ? "rental_agreement_sent" : "rental_agreement_send_failed",
      entityType: "ContractEnvelope",
      entityId: envelope.id,
      metadata: { orderId: input.orderId, to, prefilled: valueRows.length },
    });

    return envelope;
  } catch (error) {
    await logActivity({
      workspaceId: input.workspaceId,
      actor: "direct-booking",
      action: "rental_agreement_send_failed",
      entityType: "Order",
      entityId: input.orderId,
      metadata: { error: error instanceof Error ? error.message : String(error) },
    }).catch(() => undefined);
    return null;
  }
}

/** Field keys are addressed by their printed label on the template. */
function labelFor(key: string) {
  return RENTAL_AGREEMENT_FIELD_LABELS[key as RentalAgreementFieldKey] ?? key;
}

const RENTAL_AGREEMENT_FIELD_LABELS: Record<RentalAgreementFieldKey, string> = {
  renterName: "Renter's Name",
  renterPhone: "Phone Number",
  renterEmail: "Email",
  renterAddress: "Renter's Address",
  vehicle: "Rental Vehicle",
  vehicleVin: "VIN",
  licensePlate: "License Plate",
  rentalStartDate: "Rental Start Date",
  rentalEndDate: "Rental End Date",
  beginningMileage: "Beginning Mileage (km)",
  fuelLevel: "Fuel Level",
  rentalPrice: "Rental Price",
  securityDeposit: "Security Deposit",
  insuranceFee: "ICBC Insurance",
  paymentMethodOnFile: "Payment Method on File",
  renterSignature: "Renter Signature",
  signedDate: "Date Signed",
};
