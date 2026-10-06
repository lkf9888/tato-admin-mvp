import { readFile } from "fs/promises";
import path from "path";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { pdfLibFontkit } from "@/lib/contract-pdf-fontkit";

/**
 * Drawing contract text that might not be in English.
 *
 * pdf-lib's StandardFonts are WinAnsi-only and `drawText` THROWS on anything
 * outside it. A renter named 张三 made the signed PDF fail to generate -- the
 * envelope stayed unfinished and the renter never got their copy -- and a
 * Chinese Word contract or clause came out as a page of "?". Same code (from
 * HostHub, which hit both first) for the signed PDF, the Word render and the
 * rental agreement. The rules that matter:
 *
 *   - **Two faces, chosen per run.** pdf-lib's CFF subsetter drops the
 *     subroutines Noto Sans SC's LATIN glyphs depend on, so drawing Latin
 *     through the embedded face silently mangles it — "2980 Number 3 Rd" came
 *     out "2980 N m 3 R". CJK glyphs are unaffected. So anything WinAnsi can
 *     encode goes through standard Helvetica and only real CJK runs go through
 *     the embedded font.
 *   - **Embedded only when needed.** Reading and subsetting an 8 MB font costs
 *     real time on a cold start; a Latin-only document never pays it.
 *   - **Subset.** Only the glyphs actually used are written out: a contract
 *     with a few dozen hanzi adds roughly 40 KB, not 7 MB.
 */

/**
 * Everything the standard WinAnsi faces can encode: Latin-1, plus the
 * typographic marks WinAnsi keeps in 0x80-0x9F (curly quotes, dashes,
 * bullet, euro). Those stay in Helvetica rather than counting as CJK.
 */
export const WINANSI_RE = /[\x09\x0A\x0D\x20-\x7E\u00A0-\u00FF\u20AC\u201A\u0192\u201E\u2026\u2020\u2021\u02C6\u2030\u0160\u2039\u0152\u017D\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u02DC\u2122\u0161\u203A\u0153\u017E\u0178]/;

/** True when this string needs the embedded face for any of its characters. */
export function needsCjkFont(...values: Array<string | null | undefined>): boolean {
  return values.some(
    (value) => value && [...value].some((ch) => !WINANSI_RE.test(ch)),
  );
}

let cjkFontBytes: Buffer | null = null;

/**
 * The CJK face, embedded into this document.
 *
 * TrueType, not the CFF `.otf` this used to load. pdf-lib's bundled subsetter
 * corrupted that one so thoroughly that fontTools could not parse the result —
 * Chinese came out as `! " # $ % & ' ( )` in Quick Look and as empty boxes in
 * pdf.js. The font is a static instance of the official variable Noto Sans SC,
 * and the subsetting now runs through the maintained fontkit; see contract-pdf-fontkit.
 *
 * Falls back to Helvetica rather than failing: a missing font file must never
 * be the reason a signature or a contract cannot be produced, and the run
 * splitting below keeps drawText from throwing either way.
 */
export async function loadCjkFont(pdf: PDFDocument): Promise<PDFFont> {
  try {
    cjkFontBytes ??= await readFile(
      path.join(process.cwd(), "server/fonts/NotoSansSC-Regular.ttf"),
    );
    pdf.registerFontkit(pdfLibFontkit);
    return await pdf.embedFont(cjkFontBytes, { subset: true });
  } catch {
    return pdf.embedFont(StandardFonts.Helvetica);
  }
}

export type PdfFontPair = { latin: PDFFont; cjk: PDFFont };

/**
 * Both faces for one document, embedding the CJK one only if `content` needs it.
 */
export async function loadFontPair(
  pdf: PDFDocument,
  content: Array<string | null | undefined>,
  latinFont: (typeof StandardFonts)[keyof typeof StandardFonts] = StandardFonts.Helvetica,
): Promise<PdfFontPair> {
  const latin = await pdf.embedFont(latinFont);
  const cjk = needsCjkFont(...content) ? await loadCjkFont(pdf) : latin;
  return { latin, cjk };
}

export type Segment = { text: string; font: PDFFont; width: number };

export function safeWidth(font: PDFFont, text: string, size: number) {
  try {
    return font.widthOfTextAtSize(text, size);
  } catch {
    return text.length * size * 0.6;
  }
}

/**
 * Words and characters a line may break between: a Latin word with the
 * spaces after it, or a single CJK character (CJK has no spaces, so any
 * character boundary is a break point).
 */
function breakableTokens(text: string) {
  const tokens: Array<{ text: string; latin: boolean }> = [];
  for (const run of splitByScript(text)) {
    if (run.latin) {
      for (const word of run.text.match(/\S+\s*|\s+/g) ?? []) tokens.push({ text: word, latin: true });
    } else {
      for (const ch of run.text) tokens.push({ text: ch, latin: false });
    }
  }
  return tokens;
}

/** One string as alternating Latin / CJK segments, each in its face and measured. */
export function splitRuns(text: string, fonts: PdfFontPair, size: number): Segment[] {
  return splitByScript(text).map((run) => {
    const font = run.latin ? fonts.latin : fonts.cjk;
    return { text: run.text, font, width: safeWidth(font, run.text, size) };
  });
}

function splitByScript(text: string) {
  const runs: Array<{ text: string; latin: boolean }> = [];
  for (const ch of text) {
    const latin = WINANSI_RE.test(ch);
    const last = runs[runs.length - 1];
    if (last && last.latin === latin) last.text += ch;
    else runs.push({ text: ch, latin });
  }
  return runs;
}

/**
 * Greedy wrap: English breaks between words, Chinese between characters,
 * and a word too long for a whole line between its letters.
 *
 * `collapseWhitespace` is what tells a form field from a document body: a value
 * stamped into a box is one logical string and its stray newlines are noise,
 * while a paragraph of contract text keeps the shape the author gave it.
 */
export function layoutLines(
  text: string,
  fonts: PdfFontPair,
  size: number,
  maxWidth: number,
  opts: { collapseWhitespace?: boolean } = {},
): Segment[][] {
  const lines: Segment[][] = [];
  let line: Segment[] = [];
  let lineWidth = 0;
  // Runs merge only within a script: when the CJK face fell back to
  // Helvetica, a merged run would make drawText drop the whole line.
  let lastLatin: boolean | null = null;
  const push = () => {
    const last = line[line.length - 1];
    if (last && /\s$/.test(last.text)) {
      last.text = last.text.trimEnd();
      last.width = safeWidth(last.font, last.text, size);
    }
    if (line.length) lines.push(line);
    line = [];
    lineWidth = 0;
    lastLatin = null;
  };
  const append = (piece: string, font: PDFFont, latin: boolean) => {
    const last = line[line.length - 1];
    const merge = last && last.font === font && lastLatin === latin;
    lastLatin = latin;
    if (merge) {
      lineWidth -= last.width;
      last.text += piece;
      last.width = safeWidth(font, last.text, size);
      lineWidth += last.width;
    } else {
      const width = safeWidth(font, piece, size);
      line.push({ text: piece, font, width });
      lineWidth += width;
    }
  };

  for (const paragraph of text.split(/\r?\n/)) {
    const source = opts.collapseWhitespace === false
      ? paragraph
      : paragraph.replace(/\s+/g, " ").trim();
    for (const token of breakableTokens(source)) {
      const font = token.latin ? fonts.latin : fonts.cjk;
      const width = safeWidth(font, token.text.trimEnd(), size);
      if (line.length && lineWidth + width > maxWidth) push();
      if (!line.length && !token.text.trim()) continue;
      if (width <= maxWidth) {
        append(token.text, font, token.latin);
        continue;
      }
      for (const ch of token.text) {
        if (line.length && lineWidth + safeWidth(font, ch, size) > maxWidth) push();
        append(ch, font, token.latin);
      }
    }
    push();
  }
  return lines.length ? lines : [[]];
}

/** Draw one laid-out line, run by run, left to right from `x`. */
export function drawSegments(
  page: PDFPage,
  segments: Segment[],
  x: number,
  y: number,
  size: number,
  color = rgb(0.06, 0.06, 0.06),
) {
  let cursor = x;
  for (const segment of segments) {
    try {
      page.drawText(segment.text, { x: cursor, y, size, font: segment.font, color });
    } catch {
      // A glyph neither face can encode must not abort the whole document.
    }
    cursor += segment.width;
  }
}
