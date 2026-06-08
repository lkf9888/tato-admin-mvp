import { createHash } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFPage,
  type PDFFont,
} from "pdf-lib";
import { prisma } from "@/lib/prisma";
import {
  makeContractEnvelopeSignedPdfPath,
  resolveUploadPath,
} from "@/lib/uploads";

export type ContractPageSize = {
  page: number;
  width: number;
  height: number;
};

export type ContractPdfField = {
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
};

export type ContractPdfFieldValue = {
  fieldId: string;
  value: string | null;
  signature: string | null;
  checked: boolean | null;
};

export async function getPdfPageSizesFromUrl(
  pdfUrl: string,
): Promise<ContractPageSize[]> {
  const bytes = await fetchPdfBytes(pdfUrl);
  const pdf = await PDFDocument.load(bytes);
  return pdf.getPages().map((page, index) => {
    const size = page.getSize();
    return {
      page: index + 1,
      width: Math.round(size.width),
      height: Math.round(size.height),
    };
  });
}

export async function renderSignedContractPdf({
  templatePdfUrl,
  fields,
  values,
}: {
  templatePdfUrl: string;
  fields: ContractPdfField[];
  values: ContractPdfFieldValue[];
}) {
  const bytes = await fetchPdfBytes(templatePdfUrl);
  const pdf = await PDFDocument.load(bytes);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const valuesByField = new Map(values.map((value) => [value.fieldId, value]));

  for (const field of fields) {
    const page = pdf.getPages()[field.page - 1];
    if (!page) continue;
    const value = valuesByField.get(field.id);
    const box = fieldBox(page, field);
    if (field.type === "REDACTION") {
      drawRedaction(page, box);
      continue;
    }
    drawFieldBorder(page, box);

    if (field.type === "CHECKBOX") {
      drawCheckbox(page, box, value?.checked === true || value?.value === "true", bold);
      continue;
    }

    if (field.type === "SIGNATURE") {
      if (value?.signature) {
        await drawSignature(pdf, page, box, value.signature);
      } else if (value?.value) {
        drawText(page, value.value, box, bold, field.fontSize ?? 18);
      }
      continue;
    }

    const text =
      value?.value ||
      field.defaultValue ||
      (field.type === "DATE" ? new Date().toISOString().slice(0, 10) : "");
    if (text) drawText(page, text, box, regular, field.fontSize ?? 10);
  }

  const output = Buffer.from(await pdf.save());
  return {
    buffer: output,
    sha256: createHash("sha256").update(output).digest("hex"),
  };
}

function drawRedaction(
  page: PDFPage,
  box: { x: number; y: number; width: number; height: number },
) {
  page.drawRectangle({
    ...box,
    color: rgb(1, 1, 1),
    borderWidth: 0,
  });
}

export async function uploadSignedContractPdf({
  envelopeId,
  title,
  buffer,
  baseUrl,
}: {
  envelopeId: string;
  title: string;
  buffer: Buffer;
  baseUrl?: string;
}) {
  const safeTitle = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "contract";
  const pathname = makeContractEnvelopeSignedPdfPath(envelopeId, `${safeTitle}-signed.pdf`);
  const absolutePath = resolveUploadPath(pathname);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, buffer);

  return {
    url: baseUrl ? `${baseUrl}/api/contracts/envelopes/${envelopeId}/signed-pdf` : "",
    pathname,
    contentType: "application/pdf",
    size: buffer.length,
  };
}

export async function writeContractAuditLog({
  workspaceId,
  envelopeId,
  recipientId,
  event,
  req,
  metadata,
}: {
  workspaceId: string | null | undefined;
  envelopeId: string;
  recipientId?: string | null;
  event:
    | "CREATED"
    | "SENT"
    | "VIEWED"
    | "SIGNED"
    | "COMPLETED"
    | "VOIDED"
    | "PDF_GENERATED"
    | "EMAIL_FAILED";
  req?: Request;
  metadata?: unknown;
}) {
  await prisma.contractAuditLog.create({
    data: {
      workspaceId: workspaceId ?? null,
      envelopeId,
      recipientId: recipientId ?? null,
      event,
      ip: req ? clientIp(req) : null,
      userAgent: req?.headers.get("user-agent") || null,
      metadata: metadata == null ? undefined : metadata,
    },
  });
}

function fieldBox(page: PDFPage, field: ContractPdfField) {
  const size = page.getSize();
  const x = clamp(field.x, 0, 1) * size.width;
  const width = Math.max(8, clamp(field.width, 0.01, 1) * size.width);
  const height = Math.max(8, clamp(field.height, 0.01, 1) * size.height);
  const y = size.height - clamp(field.y, 0, 1) * size.height - height;
  return { x, y, width, height };
}

function drawFieldBorder(
  page: PDFPage,
  box: { x: number; y: number; width: number; height: number },
) {
  page.drawRectangle({
    ...box,
    borderColor: rgb(0.15, 0.15, 0.15),
    borderWidth: 0.5,
    color: rgb(1, 1, 1),
    opacity: 0.08,
  });
}

function drawText(
  page: PDFPage,
  text: string,
  box: { x: number; y: number; width: number; height: number },
  font: PDFFont,
  preferredSize: number,
) {
  const size = Math.max(7, Math.min(preferredSize, box.height * 0.65));
  const lines = wrapText(text, font, size, box.width - 8);
  const startY = box.y + box.height - size - 4;
  for (const [index, line] of lines.slice(0, 4).entries()) {
    page.drawText(line, {
      x: box.x + 4,
      y: startY - index * (size + 3),
      size,
      font,
      color: rgb(0.05, 0.05, 0.05),
    });
  }
}

function drawCheckbox(
  page: PDFPage,
  box: { x: number; y: number; width: number; height: number },
  checked: boolean,
  font: PDFFont,
) {
  const size = Math.min(box.width, box.height, 16);
  const x = box.x + 4;
  const y = box.y + (box.height - size) / 2;
  page.drawRectangle({
    x,
    y,
    width: size,
    height: size,
    borderColor: rgb(0.05, 0.05, 0.05),
    borderWidth: 1,
  });
  if (checked) {
    page.drawText("✓", {
      x: x + 2.5,
      y: y + 1.5,
      size: size - 2,
      font,
      color: rgb(0, 0.45, 0.25),
    });
  }
}

async function drawSignature(
  pdf: PDFDocument,
  page: PDFPage,
  box: { x: number; y: number; width: number; height: number },
  dataUrl: string,
) {
  const base64 = dataUrl.split(",")[1];
  if (!base64) return;
  const imageBytes = Buffer.from(base64, "base64");
  const image = dataUrl.startsWith("data:image/jpeg") || dataUrl.startsWith("data:image/jpg")
    ? await pdf.embedJpg(imageBytes)
    : await pdf.embedPng(imageBytes);
  const fitted = image.scaleToFit(box.width - 8, box.height - 8);
  page.drawImage(image, {
    x: box.x + (box.width - fitted.width) / 2,
    y: box.y + (box.height - fitted.height) / 2,
    width: fitted.width,
    height: fitted.height,
  });
}

async function fetchPdfBytes(url: string) {
  if (!/^https?:\/\//i.test(url) && !url.startsWith("/")) {
    return readFile(resolveUploadPath(url));
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch PDF: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number) {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= maxWidth || !line) {
      line = next;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [text.slice(0, 120)];
}

function clientIp(req: Request) {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    null
  );
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
