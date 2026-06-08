import { createHash } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import JSZip from "jszip";
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
} from "pdf-lib";
import type { ContractPageSize } from "@/lib/contract-signing";
import {
  makeContractTemplatePdfPath,
  resolveUploadPath,
} from "@/lib/uploads";

const LETTER_WIDTH = 612;
const LETTER_HEIGHT = 792;
const MARGIN_X = 54;
const MARGIN_Y = 54;

export async function fetchDocumentBytes(urlOrPathname: string) {
  if (!/^https?:\/\//i.test(urlOrPathname) && !urlOrPathname.startsWith("/")) {
    return readFile(resolveUploadPath(urlOrPathname));
  }

  const res = await fetch(urlOrPathname);
  if (!res.ok) {
    throw new Error(`Unable to fetch uploaded document (${res.status}).`);
  }
  return Buffer.from(await res.arrayBuffer());
}

export async function extractDocxPlainText(bytes: Buffer) {
  const zip = await JSZip.loadAsync(bytes);
  const documentXml = await zip.file("word/document.xml")?.async("string");
  if (!documentXml) return "";

  const paragraphs = documentXml.match(/<w:p[\s\S]*?<\/w:p>/g) || [];
  return paragraphs
    .map((paragraph) => {
      const runs = Array.from(paragraph.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g))
        .map((match) => decodeXml(match[1] || ""));
      const withBreaks = runs.join("")
        .replace(/<w:tab\s*\/>/g, "\t")
        .replace(/<w:br\s*\/>/g, "\n");
      return withBreaks.trimEnd();
    })
    .filter((paragraph) => paragraph.trim())
    .join("\n\n")
    .trim();
}

export async function renderUploadedContractDocumentPdf({
  sourceType,
  sourceUrl,
  sourcePathname,
  title,
}: {
  sourceType: "PDF" | "WORD";
  sourceUrl?: string;
  sourcePathname?: string;
  title: string;
}) {
  const bytes = sourcePathname
    ? await fetchDocumentBytes(sourcePathname)
    : await fetchDocumentBytes(sourceUrl || "");
  if (sourceType === "WORD") {
    const editableContent = normalizeEditableContent(
      await extractDocxPlainText(bytes) || title,
    );
    return renderEditableContractPdf({ title, content: editableContent });
  }

  const pdf = await PDFDocument.load(bytes);
  const output = Buffer.from(await pdf.save());
  const pageSizes = pdf.getPages().map((page, index) => {
    const size = page.getSize();
    return { page: index + 1, width: size.width, height: size.height };
  });
  return {
    buffer: output,
    pageSizes,
    sha256: createHash("sha256").update(output).digest("hex"),
  };
}

export async function mergeContractPdfBuffers(buffers: Buffer[]) {
  const outputPdf = await PDFDocument.create();
  const pageSizes: ContractPageSize[] = [];

  for (const buffer of buffers) {
    const sourcePdf = await PDFDocument.load(buffer);
    const copiedPages = await outputPdf.copyPages(
      sourcePdf,
      sourcePdf.getPageIndices(),
    );
    for (const copiedPage of copiedPages) {
      const page = outputPdf.addPage(copiedPage);
      const size = page.getSize();
      pageSizes.push({
        page: pageSizes.length + 1,
        width: size.width,
        height: size.height,
      });
    }
  }

  const output = Buffer.from(await outputPdf.save());
  return {
    buffer: output,
    pageSizes,
    sha256: createHash("sha256").update(output).digest("hex"),
  };
}

export async function renderEditableContractPdf({
  title,
  content,
}: {
  title: string;
  content: string;
}): Promise<{ buffer: Buffer; pageSizes: ContractPageSize[]; sha256: string }> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pageSizes: ContractPageSize[] = [];
  let page = pdf.addPage([LETTER_WIDTH, LETTER_HEIGHT]);
  pageSizes.push({ page: 1, width: LETTER_WIDTH, height: LETTER_HEIGHT });
  let y = LETTER_HEIGHT - MARGIN_Y;

  function addPage() {
    page = pdf.addPage([LETTER_WIDTH, LETTER_HEIGHT]);
    pageSizes.push({ page: pageSizes.length + 1, width: LETTER_WIDTH, height: LETTER_HEIGHT });
    y = LETTER_HEIGHT - MARGIN_Y;
  }

  function drawLine(text: string, font: PDFFont, size: number, lineGap = 4) {
    if (y < MARGIN_Y + size + lineGap) addPage();
    page.drawText(toWinAnsi(text), {
      x: MARGIN_X,
      y,
      size,
      font,
      color: rgb(0.06, 0.06, 0.06),
    });
    y -= size + lineGap;
  }

  drawLine(title, bold, 16, 8);
  y -= 8;

  const paragraphs = normalizeEditableContent(content).split(/\n{2,}/);
  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim();
    if (!trimmed) {
      y -= 8;
      continue;
    }
    const lines = wrapPdfText(trimmed.replace(/\s*\n\s*/g, " "), regular, 10.5, LETTER_WIDTH - MARGIN_X * 2);
    for (const line of lines) {
      drawLine(line, regular, 10.5, 4.5);
    }
    y -= 6;
  }

  const output = Buffer.from(await pdf.save());
  return {
    buffer: output,
    pageSizes,
    sha256: createHash("sha256").update(output).digest("hex"),
  };
}

export async function uploadGeneratedTemplatePdf({
  templateId,
  title,
  buffer,
  baseUrl,
}: {
  templateId: string;
  title: string;
  buffer: Buffer;
  baseUrl?: string;
}) {
  const safeTitle = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "contract";
  const pathname = makeContractTemplatePdfPath(templateId, `${safeTitle}-generated.pdf`);
  const absolutePath = resolveUploadPath(pathname);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, buffer);

  return {
    url: baseUrl ? `${baseUrl}/api/contracts/templates/${templateId}/file?kind=pdf` : "",
    pathname,
    contentType: "application/pdf",
    size: buffer.length,
  };
}

export function normalizeEditableContent(value: string) {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function wrapPdfText(text: string, font: PDFFont, size: number, maxWidth: number) {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [""];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(toWinAnsi(candidate), size) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = word;
  }
  if (current) lines.push(current);
  return lines;
}

function decodeXml(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'");
}

function toWinAnsi(value: string) {
  return value.replace(/[^\x09\x0A\x0D\x20-\x7E\u00A0-\u00FF]/g, "?");
}
