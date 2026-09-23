import "server-only";

import { createHash } from "crypto";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

import { mergeContractPdfBuffers, renderEditableContractPdf } from "@/lib/contract-documents";
import type { ContractPageSize } from "@/lib/contract-signing";
import {
  RENTAL_AGREEMENT_CLAUSES,
  RENTAL_AGREEMENT_TITLE,
} from "@/lib/rental-agreement-text";

const LETTER_WIDTH = 612;
const LETTER_HEIGHT = 792;
const MARGIN = 54;
const COLUMN_GAP = 24;
const COLUMN_WIDTH = (LETTER_WIDTH - MARGIN * 2 - COLUMN_GAP) / 2;
const BOX_HEIGHT = 22;
const LABEL_SIZE = 8;
const ROW_GAP = 14;

/**
 * The agreement as a signable PDF.
 *
 * Three parts, in order: a details page whose boxes are drawn at known
 * positions, the clauses as flowing text, and a signature page. Only
 * the first and last carry fields, which is the whole reason for the
 * split -- field coordinates have to be known in advance, and text
 * that reflows cannot tell you where it landed.
 */

export type RentalAgreementFieldKey =
  | "renterName"
  | "renterPhone"
  | "renterEmail"
  | "renterAddress"
  | "vehicle"
  | "vehicleVin"
  | "licensePlate"
  | "rentalStartDate"
  | "rentalEndDate"
  | "beginningMileage"
  | "fuelLevel"
  | "rentalPrice"
  | "securityDeposit"
  | "insuranceFee"
  | "dailyKmAllowance"
  | "extraKmRate"
  | "paymentMethodOnFile"
  | "renterSignature"
  | "signedDate";

export type RentalAgreementField = {
  key: RentalAgreementFieldKey;
  type: "TEXT" | "SIGNATURE" | "DATE";
  label: string;
  page: number;
  /** Normalised 0-1, y measured from the top, as ContractTemplateField is. */
  x: number;
  y: number;
  width: number;
  height: number;
  /**
   * Which signer may edit it.
   *
   * `null` means the renter (signing order 1). A number with no
   * matching recipient means nobody: the value still renders into the
   * signed PDF, but the field is never handed to the signer. That is
   * how the booking's own facts -- the price above all -- get printed
   * on the contract without the person signing it being able to retype
   * them.
   */
  recipientIndex: number | null;
  required: boolean;
};

/** No recipient carries this order, so no signer is offered the field. */
const NOT_EDITABLE = 9;

type Placement = { page: number; x: number; y: number; width: number; height: number };

function toNormalised(placement: {
  page: number;
  xPt: number;
  yTopPt: number;
  widthPt: number;
  heightPt: number;
}): Placement {
  return {
    page: placement.page,
    x: placement.xPt / LETTER_WIDTH,
    y: placement.yTopPt / LETTER_HEIGHT,
    width: placement.widthPt / LETTER_WIDTH,
    height: placement.heightPt / LETTER_HEIGHT,
  };
}

/** pdf-lib draws from the bottom-left; every offset here is from the top. */
function drawLabelledBox(
  page: PDFPage,
  font: PDFFont,
  input: { label: string; xPt: number; yTopPt: number; widthPt: number; heightPt: number },
) {
  page.drawText(input.label.toUpperCase(), {
    x: input.xPt,
    y: LETTER_HEIGHT - input.yTopPt - LABEL_SIZE,
    size: LABEL_SIZE,
    font,
    color: rgb(0.42, 0.42, 0.45),
  });
  page.drawRectangle({
    x: input.xPt,
    y: LETTER_HEIGHT - input.yTopPt - LABEL_SIZE - 4 - input.heightPt,
    width: input.widthPt,
    height: input.heightPt,
    borderColor: rgb(0.8, 0.8, 0.82),
    borderWidth: 0.8,
  });
}

function boxTopPt(rowTopPt: number) {
  return rowTopPt + LABEL_SIZE + 4;
}

type RowSpec = { key: RentalAgreementFieldKey; label: string; full?: boolean };

/** The details page, in reading order. Two per line unless `full`. */
const DETAIL_ROWS: RowSpec[] = [
  { key: "renterName", label: "Renter's Name" },
  { key: "renterPhone", label: "Phone Number" },
  { key: "renterEmail", label: "Email" },
  { key: "renterAddress", label: "Renter's Address" },
  { key: "vehicle", label: "Rental Vehicle" },
  { key: "licensePlate", label: "License Plate" },
  { key: "vehicleVin", label: "VIN" },
  { key: "rentalStartDate", label: "Rental Start Date" },
  { key: "rentalEndDate", label: "Rental End Date" },
  { key: "beginningMileage", label: "Beginning Mileage (km)" },
  { key: "fuelLevel", label: "Fuel Level" },
  { key: "dailyKmAllowance", label: "Daily Mileage Allowance" },
  { key: "extraKmRate", label: "Excess Mileage Rate" },
  { key: "rentalPrice", label: "Rental Price" },
  { key: "securityDeposit", label: "Security Deposit" },
  { key: "insuranceFee", label: "ICBC Insurance" },
  { key: "paymentMethodOnFile", label: "Payment Method on File", full: true },
];

/** What the renter fills in themselves. Everything else is printed. */
const RENTER_EDITABLE = new Set<RentalAgreementFieldKey>([
  "renterAddress",
  "renterSignature",
  "signedDate",
]);

async function renderDetailsPage(input: { ownerName: string; ownerAddress: string }) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([LETTER_WIDTH, LETTER_HEIGHT]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  page.drawText(RENTAL_AGREEMENT_TITLE, {
    x: MARGIN,
    y: LETTER_HEIGHT - MARGIN - 16,
    size: 16,
    font: bold,
    color: rgb(0.06, 0.06, 0.06),
  });

  let top = MARGIN + 34;
  for (const line of [`Owner: ${input.ownerName}`, `Owner's Address: ${input.ownerAddress}`]) {
    page.drawText(line, {
      x: MARGIN,
      y: LETTER_HEIGHT - top - 10,
      size: 10,
      font: regular,
      color: rgb(0.18, 0.18, 0.2),
    });
    top += 15;
  }

  top += 10;
  const placements = new Map<RentalAgreementFieldKey, Placement>();
  let column = 0;

  for (const row of DETAIL_ROWS) {
    if (row.full && column === 1) {
      column = 0;
      top += BOX_HEIGHT + LABEL_SIZE + 4 + ROW_GAP;
    }
    const widthPt = row.full ? COLUMN_WIDTH * 2 + COLUMN_GAP : COLUMN_WIDTH;
    const xPt = MARGIN + (column === 0 ? 0 : COLUMN_WIDTH + COLUMN_GAP);

    drawLabelledBox(page, regular, {
      label: row.label,
      xPt,
      yTopPt: top,
      widthPt,
      heightPt: BOX_HEIGHT,
    });
    placements.set(
      row.key,
      toNormalised({
        page: 1,
        xPt,
        yTopPt: boxTopPt(top),
        widthPt,
        heightPt: BOX_HEIGHT,
      }),
    );

    if (row.full || column === 1) {
      column = 0;
      top += BOX_HEIGHT + LABEL_SIZE + 4 + ROW_GAP;
    } else {
      column = 1;
    }
  }

  return { buffer: Buffer.from(await pdf.save()), placements };
}

async function renderSignaturePage(pageNumber: number, ownerName: string) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([LETTER_WIDTH, LETTER_HEIGHT]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  page.drawText("Signatures", {
    x: MARGIN,
    y: LETTER_HEIGHT - MARGIN - 14,
    size: 14,
    font: bold,
    color: rgb(0.06, 0.06, 0.06),
  });

  const intro =
    "By signing below the Renter confirms they have read and agree to every clause of this agreement.";
  page.drawText(intro, {
    x: MARGIN,
    y: LETTER_HEIGHT - MARGIN - 34,
    size: 9.5,
    font: regular,
    color: rgb(0.3, 0.3, 0.32),
  });

  const signatureTop = MARGIN + 60;
  const signatureHeight = 64;
  drawLabelledBox(page, regular, {
    label: "Renter Signature",
    xPt: MARGIN,
    yTopPt: signatureTop,
    widthPt: COLUMN_WIDTH,
    heightPt: signatureHeight,
  });
  drawLabelledBox(page, regular, {
    label: "Date Signed",
    xPt: MARGIN + COLUMN_WIDTH + COLUMN_GAP,
    yTopPt: signatureTop,
    widthPt: COLUMN_WIDTH,
    heightPt: signatureHeight,
  });

  // The owner's side is signed once, by the business, not per booking.
  const ownerTop = signatureTop + signatureHeight + LABEL_SIZE + 4 + 30;
  page.drawText(`Owner: ${ownerName} (Director)`, {
    x: MARGIN,
    y: LETTER_HEIGHT - ownerTop - 10,
    size: 10,
    font: regular,
    color: rgb(0.18, 0.18, 0.2),
  });

  const placements = new Map<RentalAgreementFieldKey, Placement>([
    [
      "renterSignature",
      toNormalised({
        page: pageNumber,
        xPt: MARGIN,
        yTopPt: boxTopPt(signatureTop),
        widthPt: COLUMN_WIDTH,
        heightPt: signatureHeight,
      }),
    ],
    [
      "signedDate",
      toNormalised({
        page: pageNumber,
        xPt: MARGIN + COLUMN_WIDTH + COLUMN_GAP,
        yTopPt: boxTopPt(signatureTop),
        widthPt: COLUMN_WIDTH,
        heightPt: signatureHeight,
      }),
    ],
  ]);

  return { buffer: Buffer.from(await pdf.save()), placements };
}

export async function renderRentalAgreementTemplatePdf(input: {
  ownerName: string;
  ownerAddress: string;
}): Promise<{
  buffer: Buffer;
  pageSizes: ContractPageSize[];
  sha256: string;
  fields: RentalAgreementField[];
}> {
  const details = await renderDetailsPage(input);

  const clauseText = RENTAL_AGREEMENT_CLAUSES.map(
    (clause) => `${clause.heading}\n${clause.body}`,
  ).join("\n\n");
  const clauses = await renderEditableContractPdf({
    title: RENTAL_AGREEMENT_TITLE,
    content: clauseText,
  });

  // The signature page's number is only knowable once the clauses have
  // been laid out, which is why it is rendered last.
  const signaturePageNumber = 1 + clauses.pageSizes.length + 1;
  const signature = await renderSignaturePage(signaturePageNumber, input.ownerName);

  const merged = await mergeContractPdfBuffers([
    details.buffer,
    clauses.buffer,
    signature.buffer,
  ]);

  const placements = new Map([...details.placements, ...signature.placements]);
  const labels = new Map<RentalAgreementFieldKey, string>([
    ...DETAIL_ROWS.map((row) => [row.key, row.label] as const),
    ["renterSignature", "Renter Signature"],
    ["signedDate", "Date Signed"],
  ]);

  const fields: RentalAgreementField[] = [...placements.entries()].map(([key, placement]) => ({
    key,
    type:
      key === "renterSignature" ? "SIGNATURE" : key === "signedDate" ? "DATE" : "TEXT",
    label: labels.get(key) ?? key,
    ...placement,
    recipientIndex: RENTER_EDITABLE.has(key) ? null : NOT_EDITABLE,
    required: key === "renterSignature",
  }));

  return {
    buffer: merged.buffer,
    pageSizes: merged.pageSizes,
    sha256: createHash("sha256").update(merged.buffer).digest("hex"),
    fields,
  };
}
