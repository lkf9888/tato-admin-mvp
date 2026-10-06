import { createHash } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import JSZip from "jszip";
import {
  PDFDocument,
  StandardFonts,
  rgb,
} from "pdf-lib";
import {
  drawSegments,
  layoutLines,
  loadCjkFont,
  needsCjkFont,
  splitRuns,
  type PdfFontPair,
  type Segment,
} from "@/lib/contract-pdf-text";
import { parseDocxBlocks, type DocxBlock, type DocxRun } from "@/lib/contract-docx-blocks";
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

/**
 * Open a .docx far enough to read its structure.
 *
 * styles.xml and numbering.xml are not optional extras: Word's own "List
 * Number" style keeps the numPr, and the numbers themselves live in
 * numbering.xml, so a reader that opens only document.xml finds a numbered
 * contract with no numbers in it anywhere.
 */
export async function extractDocxBlocks(bytes: Buffer): Promise<DocxBlock[]> {
  try {
    const zip = await JSZip.loadAsync(bytes);
    const document = await zip.file("word/document.xml")?.async("string");
    if (!document) return [];
    return parseDocxBlocks({
      document,
      styles: await zip.file("word/styles.xml")?.async("string"),
      numbering: await zip.file("word/numbering.xml")?.async("string"),
    });
  } catch {
    // An unreadable .docx falls back to the plain-text path rather than
    // failing the upload: some text is better than a refused document.
    return [];
  }
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
    // Structure first: clause numbers live in numbering.xml and never in
    // the text, so the plain-text reader dropped every one of them, every
    // table and every bold word. Plain text stays as the fallback.
    const blocks = await extractDocxBlocks(bytes);
    if (blocks.length) return renderDocxBlocksPdf({ title, blocks });
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
  // Chinese wording used to print as "?": Helvetica cannot encode it.
  const cjk = needsCjkFont(title, content) ? await loadCjkFont(pdf) : null;
  const latin = await pdf.embedFont(StandardFonts.Helvetica);
  const regular: PdfFontPair = { latin, cjk: cjk ?? latin };
  const boldLatin = await pdf.embedFont(StandardFonts.HelveticaBold);
  const bold: PdfFontPair = { latin: boldLatin, cjk: cjk ?? boldLatin };
  const pageSizes: ContractPageSize[] = [];
  let page = pdf.addPage([LETTER_WIDTH, LETTER_HEIGHT]);
  pageSizes.push({ page: 1, width: LETTER_WIDTH, height: LETTER_HEIGHT });
  let y = LETTER_HEIGHT - MARGIN_Y;

  function addPage() {
    page = pdf.addPage([LETTER_WIDTH, LETTER_HEIGHT]);
    pageSizes.push({ page: pageSizes.length + 1, width: LETTER_WIDTH, height: LETTER_HEIGHT });
    y = LETTER_HEIGHT - MARGIN_Y;
  }

  function drawLine(segments: Segment[], size: number, lineGap = 4) {
    if (y < MARGIN_Y + size + lineGap) addPage();
    drawSegments(page, segments, MARGIN_X, y, size, rgb(0.06, 0.06, 0.06));
    y -= size + lineGap;
  }

  const maxWidth = LETTER_WIDTH - MARGIN_X * 2;
  for (const line of layoutLines(title, bold, 16, maxWidth)) drawLine(line, 16, 8);
  y -= 8;

  const paragraphs = normalizeEditableContent(content).split(/\n{2,}/);
  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim();
    if (!trimmed) {
      y -= 8;
      continue;
    }
    for (const line of layoutLines(trimmed.replace(/\s*\n\s*/g, " "), regular, 10.5, maxWidth)) {
      drawLine(line, 10.5, 4.5);
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

function decodeXml(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'");
}

type DocxFonts = { regular: PdfFontPair; bold: PdfFontPair };

/**
 * Break text where a line may end.
 *
 * Latin wraps at spaces; CJK has none, so every character is its own
 * opportunity. Without this a Chinese lease renders as one line running off the
 * right edge of the page.
 */
function tokenizeForWrap(text: string): string[] {
  const out: string[] = [];
  let buffer = "";
  const flush = () => {
    if (buffer) out.push(buffer);
    buffer = "";
  };
  for (const ch of text) {
    if (ch === "\n") {
      flush();
      out.push("\n");
    } else if (/\s/.test(ch)) {
      flush();
      out.push(" ");
    } else if (/[\u2E80-\u9FFF\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFFEF]/.test(ch)) {
      flush();
      out.push(ch);
    } else {
      buffer += ch;
    }
  }
  flush();
  return out;
}

/**
 * Wrap a paragraph whose runs may each be bold or not.
 *
 * layoutLines next door takes one string and one font pair, which cannot
 * express "bold in the middle of a sentence" — and in a contract the bold bit
 * is usually the number that matters. Segments carry their own font, so
 * drawSegments renders the mixture without knowing about any of this.
 */
function layoutRuns(
  runs: DocxRun[],
  fonts: DocxFonts,
  size: number,
  maxWidth: number,
): Segment[][] {
  const lines: Segment[][] = [];
  let line: Segment[] = [];
  let width = 0;
  const flush = () => {
    lines.push(line);
    line = [];
    width = 0;
  };

  for (const run of runs) {
    const pair = run.bold ? fonts.bold : fonts.regular;
    for (const token of tokenizeForWrap(run.text)) {
      if (token === "\n") {
        flush();
        continue;
      }
      const isSpace = token === " ";
      // A line never starts with the space that ended the last one.
      if (isSpace && !line.length) continue;
      const segments = splitRuns(token, pair, size);
      const tokenWidth = segments.reduce((sum, segment) => sum + segment.width, 0);
      if (width + tokenWidth > maxWidth && line.length) {
        flush();
        if (isSpace) continue;
      }
      line.push(...segments);
      width += tokenWidth;
    }
  }
  if (line.length) lines.push(line);
  return lines.length ? lines : [[]];
}

const HEADING_SIZES = [18, 15, 13, 12, 11.5, 11];
const BODY_SIZE = 10.5;
const BODY_GAP = 4.5;
const CELL_PAD = 4;

/**
 * Draw a .docx as a PDF that still looks like the document somebody wrote.
 *
 * Everything here exists because the plain-text path lost it: see contract-docx-blocks
 * for what was going missing and why it matters in a contract.
 */
export async function renderDocxBlocksPdf({
  title,
  blocks,
}: {
  title: string;
  blocks: DocxBlock[];
}): Promise<{ buffer: Buffer; pageSizes: ContractPageSize[]; sha256: string }> {
  const pdf = await PDFDocument.create();
  const latin = await pdf.embedFont(StandardFonts.Helvetica);
  const boldLatin = await pdf.embedFont(StandardFonts.HelveticaBold);
  const everyString = blocks.flatMap((block) =>
    block.kind === "table"
      ? block.rows.flatMap((row) => row.flatMap((cell) => cell.map((run) => run.text)))
      : block.kind === "pageBreak"
        ? []
        : block.runs.map((run) => run.text),
  );
  // ONE embedded CJK face for the document — embedding it twice makes
  // fontkit's CFF subsetter throw part way through writing the file. Bold CJK
  // therefore shares the regular face; there is no bold CJK to have.
  const cjk = needsCjkFont(title, ...everyString) ? await loadCjkFont(pdf) : latin;
  const fonts: DocxFonts = {
    regular: { latin, cjk },
    bold: { latin: boldLatin, cjk },
  };

  const pageSizes: ContractPageSize[] = [];
  let page = pdf.addPage([LETTER_WIDTH, LETTER_HEIGHT]);
  pageSizes.push({ page: 1, width: LETTER_WIDTH, height: LETTER_HEIGHT });
  let y = LETTER_HEIGHT - MARGIN_Y;
  const maxWidth = LETTER_WIDTH - MARGIN_X * 2;

  function addPage() {
    page = pdf.addPage([LETTER_WIDTH, LETTER_HEIGHT]);
    pageSizes.push({ page: pageSizes.length + 1, width: LETTER_WIDTH, height: LETTER_HEIGHT });
    y = LETTER_HEIGHT - MARGIN_Y;
  }

  /**
   * `y` is the TOP of the next thing to be drawn, never a baseline.
   *
   * drawText places the baseline, so text drawn at `y` puts its capitals above
   * `y` and into whatever is already there — which had a section heading
   * sitting on the bottom border of the table above it.
   *
   * `prefix` rides on the first line's baseline: that is the clause number,
   * which has to align with the first line of its own clause and nothing else.
   */
  function drawLines(
    lines: Segment[][],
    size: number,
    gap: number,
    left: number,
    prefix?: { segments: Segment[]; x: number },
  ) {
    lines.forEach((segments, index) => {
      if (y - size < MARGIN_Y) addPage();
      y -= size;
      if (index === 0 && prefix?.segments.length) {
        drawSegments(page, prefix.segments, prefix.x, y, size);
      }
      drawSegments(page, segments, left, y, size);
      y -= gap;
    });
  }

  function drawTable(block: Extract<DocxBlock, { kind: "table" }>) {
    const columns = Math.max(...block.rows.map((row) => row.length));
    const declared = block.widths.length === columns ? block.widths : [];
    const total = declared.reduce((sum, width) => sum + width, 0);
    const widths = declared.length && total > 0
      ? declared.map((width) => (width / total) * maxWidth)
      : Array.from({ length: columns }, () => maxWidth / columns);

    for (const row of block.rows) {
      const cellLines = row.map((cell, index) =>
        layoutRuns(cell, fonts, BODY_SIZE, Math.max(20, widths[index] - CELL_PAD * 2)),
      );
      const rowHeight = Math.max(
        BODY_SIZE + CELL_PAD * 2,
        Math.max(...cellLines.map((lines) => lines.length)) * (BODY_SIZE + BODY_GAP) + CELL_PAD * 2,
      );
      // Rows are not split across pages. A party table cut in half mid-cell is
      // harder to read than one that starts on the next page.
      if (y - rowHeight < MARGIN_Y) addPage();
      const top = y;
      let x = MARGIN_X;
      cellLines.forEach((lines, index) => {
        const cellWidth = widths[index] ?? maxWidth / columns;
        page.drawRectangle({
          x,
          y: top - rowHeight,
          width: cellWidth,
          height: rowHeight,
          borderColor: rgb(0.75, 0.75, 0.75),
          borderWidth: 0.75,
        });
        let cellY = top - CELL_PAD - BODY_SIZE;
        for (const segments of lines) {
          drawSegments(page, segments, x + CELL_PAD, cellY, BODY_SIZE);
          cellY -= BODY_SIZE + BODY_GAP;
        }
        x += cellWidth;
      });
      y = top - rowHeight;
    }
    y -= 8;
  }

  // The template's name is only drawn when the document has no title of its
  // own. Drawing both printed the same line twice, one under the other.
  const hasOwnTitle = blocks.some((block) => block.kind === "heading" && block.level === 0);
  if (title.trim() && !hasOwnTitle) {
    drawLines(
      layoutRuns([{ text: title, bold: true }], fonts, HEADING_SIZES[0], maxWidth),
      HEADING_SIZES[0],
      8,
      MARGIN_X,
    );
    y -= 8;
  }

  for (const block of blocks) {
    if (block.kind === "pageBreak") {
      // Only if something has been drawn on this one — a break at the very top
      // would otherwise leave a blank sheet in the middle of the contract.
      if (y < LETTER_HEIGHT - MARGIN_Y) addPage();
      continue;
    }
    if (block.kind === "table") {
      drawTable(block);
      continue;
    }
    if (block.kind === "heading") {
      const size = HEADING_SIZES[Math.min(block.level, HEADING_SIZES.length - 1)];
      y -= 4;
      drawLines(
        layoutRuns(block.runs.map((run) => ({ ...run, bold: true })), fonts, size, maxWidth),
        size,
        6,
        MARGIN_X,
      );
      y -= 4;
      continue;
    }
    if (!block.runs.length) {
      y -= 8;
      continue;
    }
    // A numbered clause hangs its marker in the margin so the text of every
    // item lines up, which is how the list reads as a list.
    const indent = block.indent * 18;
    const marker = block.marker
      ? splitRuns(`${block.marker} `, fonts.regular, BODY_SIZE)
      : [];
    const markerWidth = marker.reduce((sum, segment) => sum + segment.width, 0);
    const left = MARGIN_X + indent + (block.marker ? markerWidth : 0);
    const lines = layoutRuns(block.runs, fonts, BODY_SIZE, maxWidth - indent - markerWidth);
    drawLines(lines, BODY_SIZE, BODY_GAP, left, { segments: marker, x: MARGIN_X + indent });
    y -= 6;
  }

  const output = Buffer.from(await pdf.save());
  return {
    buffer: output,
    pageSizes,
    sha256: createHash("sha256").update(output).digest("hex"),
  };
}
