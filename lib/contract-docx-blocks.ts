/**
 * Reading a .docx as structure, not as a wall of text.
 *
 * The plain-text reader beside this one (extractDocxPlainText) is right for the
 * editable copy a host types into. It is wrong for the PDF, because the things
 * it throws away are the things a contract is made of:
 *
 *   - a party table arrives as a column of loose cells, so nothing says which
 *     name belongs to which role;
 *   - a numbered clause list arrives with NO numbers at all, because Word keeps
 *     them in numbering.xml and never writes them into the text — which makes
 *     every cross-reference in the document ("subject to clause 4.2") point at
 *     nothing;
 *   - bold and headings vanish, so a section title reads like a sentence.
 *
 * This module parses the same file into blocks that keep all of that. It is
 * deliberately free of pdf-lib and of any I/O: the XML goes in, blocks come
 * out, and the renderer decides what they look like.
 *
 * The parsing is regular expressions over the XML rather than a DOM. That is
 * what the plain-text reader next door already does, it avoids adding an XML
 * parser to the bundle, and the shapes involved are fixed by the OOXML spec.
 * Where that costs accuracy it is marked.
 */

export type DocxRun = { text: string; bold: boolean };

export type DocxBlock =
  | { kind: "heading"; level: number; runs: DocxRun[] }
  | { kind: "paragraph"; runs: DocxRun[]; marker: string | null; indent: number }
  | { kind: "table"; rows: DocxRun[][][]; widths: number[] }
  | { kind: "pageBreak" };

type LevelFormat = { numFmt: string; lvlText: string; start: number };
type Numbering = Map<string, Map<number, LevelFormat>>;
type StyleInfo = {
  numId?: string;
  ilvl?: number;
  headingLevel?: number;
  bold?: boolean;
  basedOn?: string;
};

function decodeXml(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    // Last, or an escaped "&lt;" in the source would become a real "<".
    .replace(/&amp;/g, "&");
}

function attr(xml: string, name: string): string | undefined {
  const match = xml.match(new RegExp(`${name}="([^"]*)"`));
  return match?.[1];
}

/** numbering.xml: which concrete list uses which abstract definition, and how each level looks. */
export function parseNumbering(numberingXml: string): Numbering {
  const abstract = new Map<string, Map<number, LevelFormat>>();
  for (const block of numberingXml.match(/<w:abstractNum\b[\s\S]*?<\/w:abstractNum>/g) || []) {
    const id = attr(block, "w:abstractNumId");
    if (!id) continue;
    const levels = new Map<number, LevelFormat>();
    for (const lvl of block.match(/<w:lvl\b[\s\S]*?<\/w:lvl>/g) || []) {
      const ilvl = Number(attr(lvl, "w:ilvl") ?? "0");
      levels.set(ilvl, {
        numFmt: lvl.match(/<w:numFmt w:val="([^"]*)"/)?.[1] || "decimal",
        lvlText: decodeXml(lvl.match(/<w:lvlText w:val="([^"]*)"/)?.[1] || "%1."),
        start: Number(lvl.match(/<w:start w:val="([^"]*)"/)?.[1] || "1"),
      });
    }
    abstract.set(id, levels);
  }

  const byNumId: Numbering = new Map();
  for (const block of numberingXml.match(/<w:num\b(?![a-zA-Z])[\s\S]*?<\/w:num>/g) || []) {
    const numId = attr(block, "w:numId");
    const abstractId = block.match(/<w:abstractNumId w:val="([^"]*)"/)?.[1];
    if (!numId || abstractId === undefined) continue;
    const levels = abstract.get(abstractId);
    if (levels) byNumId.set(numId, levels);
  }
  return byNumId;
}

/**
 * styles.xml: what a style implies about the paragraphs that use it.
 *
 * Needed because a list is usually not marked on the paragraph. Word's "List
 * Number" style carries the numPr, and every paragraph merely names the style —
 * so a reader that only looks at the paragraph finds no numbering anywhere.
 */
export function parseStyles(stylesXml: string): Map<string, StyleInfo> {
  const styles = new Map<string, StyleInfo>();
  for (const block of stylesXml.match(/<w:style\b[\s\S]*?<\/w:style>/g) || []) {
    const id = attr(block, "w:styleId");
    if (!id) continue;
    const name = block.match(/<w:name w:val="([^"]*)"/)?.[1] || "";
    const numPr = block.match(/<w:numPr>[\s\S]*?<\/w:numPr>/)?.[0];
    const headingMatch = /^heading\s*(\d)$/i.exec(name) || /^Heading(\d)$/.exec(id);
    styles.set(id, {
      numId: numPr?.match(/<w:numId w:val="([^"]*)"/)?.[1],
      ilvl: numPr ? Number(numPr.match(/<w:ilvl w:val="([^"]*)"/)?.[1] ?? "0") : undefined,
      headingLevel: headingMatch
        ? Number(headingMatch[1])
        : /^title$/i.test(name) || id === "Title"
          ? 0
          : undefined,
      bold: /<w:b\/>|<w:b w:val="(?:1|true|on)"/.test(block),
      basedOn: block.match(/<w:basedOn w:val="([^"]*)"/)?.[1],
    });
  }
  return styles;
}

/** Walk the style chain, because "List Number 2" gets its numPr from its parent. */
function resolveStyle(styles: Map<string, StyleInfo>, id: string | undefined): StyleInfo {
  const seen = new Set<string>();
  const out: StyleInfo = {};
  let current = id;
  while (current && !seen.has(current)) {
    seen.add(current);
    const style = styles.get(current);
    if (!style) break;
    if (out.numId === undefined) out.numId = style.numId;
    if (out.ilvl === undefined) out.ilvl = style.ilvl;
    if (out.headingLevel === undefined) out.headingLevel = style.headingLevel;
    if (out.bold === undefined && style.bold) out.bold = true;
    current = style.basedOn;
  }
  return out;
}

const ROMAN: Array<[number, string]> = [
  [1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"],
  [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"],
];

function toRoman(value: number) {
  let left = value;
  let out = "";
  for (const [amount, numeral] of ROMAN) {
    while (left >= amount) {
      out += numeral;
      left -= amount;
    }
  }
  return out;
}

function toLetter(value: number) {
  // Word runs a..z then aa, ab — not base-26 with a zero digit.
  let left = value;
  let out = "";
  while (left > 0) {
    const index = (left - 1) % 26;
    out = String.fromCharCode(97 + index) + out;
    left = Math.floor((left - 1) / 26);
  }
  return out;
}

export function formatCounter(value: number, numFmt: string): string {
  switch (numFmt) {
    case "lowerLetter": return toLetter(value);
    case "upperLetter": return toLetter(value).toUpperCase();
    case "lowerRoman": return toRoman(value);
    case "upperRoman": return toRoman(value).toUpperCase();
    // A bullet's lvlText is a glyph from the Symbol/Wingdings font that no
    // standard PDF face can draw. One honest bullet beats a wrong glyph.
    case "bullet": return "";
    case "none": return "";
    default: return String(value);
  }
}

/**
 * Turn the running counters into the label Word would print.
 *
 * `lvlText` is a template like "%1." or "%1.%2" — the placeholders refer to
 * levels, which is how "4.2" is built out of two counters rather than stored.
 */
export function renderMarker(
  lvlText: string,
  numFmt: string,
  counters: number[],
  levels: Map<number, LevelFormat>,
): string {
  if (numFmt === "bullet") return "•";
  const text = lvlText.replace(/%(\d)/g, (_match, digit: string) => {
    const level = Number(digit) - 1;
    const value = counters[level];
    if (value === undefined) return "";
    return formatCounter(value, levels.get(level)?.numFmt || "decimal");
  });
  return text.trim();
}

/** The runs of one paragraph or cell, with bold carried through. */
function parseRuns(xml: string, styleBold: boolean): DocxRun[] {
  const runs: DocxRun[] = [];
  for (const run of xml.match(/<w:r\b(?![a-zA-Z])[\s\S]*?<\/w:r>/g) || []) {
    const props = run.match(/<w:rPr>[\s\S]*?<\/w:rPr>/)?.[0] || "";
    const bold = /<w:b\/>|<w:b w:val="(?:1|true|on)"/.test(props)
      ? true
      : /<w:b w:val="(?:0|false|off)"/.test(props)
        ? false
        : styleBold;
    let text = "";
    for (const piece of run.match(/<w:t[^>]*>[\s\S]*?<\/w:t>|<w:tab\s*\/>|<w:br[^>]*\/>/g) || []) {
      if (piece.startsWith("<w:tab")) text += "\t";
      else if (piece.startsWith("<w:br")) text += "\n";
      else text += decodeXml(piece.replace(/^<w:t[^>]*>/, "").replace(/<\/w:t>$/, ""));
    }
    if (text) runs.push({ text, bold });
  }
  return runs;
}

/**
 * Split the body into its top-level paragraphs and tables, in order.
 *
 * A scan for <w:p> alone would also find every paragraph inside every table
 * cell and emit the table's contents twice — once as loose paragraphs and once
 * as the table. Tables can also contain tables, so the depth is counted rather
 * than assumed.
 */
function topLevelBlocks(body: string): Array<{ kind: "p" | "tbl"; xml: string }> {
  const out: Array<{ kind: "p" | "tbl"; xml: string }> = [];
  const token = /<w:tbl>|<\/w:tbl>|<w:p\b(?![a-zA-Z])[^>]*\/>|<w:p\b(?![a-zA-Z])[^>]*>|<\/w:p>/g;
  let depth = 0;
  let tableStart = -1;
  let paraStart = -1;
  let match: RegExpExecArray | null;
  while ((match = token.exec(body))) {
    const tag = match[0];
    if (tag === "<w:tbl>") {
      if (depth === 0) tableStart = match.index;
      depth += 1;
    } else if (tag === "</w:tbl>") {
      depth -= 1;
      if (depth === 0 && tableStart >= 0) {
        out.push({ kind: "tbl", xml: body.slice(tableStart, match.index + tag.length) });
        tableStart = -1;
      }
    } else if (depth === 0) {
      if (tag.endsWith("/>")) out.push({ kind: "p", xml: tag });
      else if (tag === "</w:p>") {
        if (paraStart >= 0) out.push({ kind: "p", xml: body.slice(paraStart, match.index + tag.length) });
        paraStart = -1;
      } else paraStart = match.index;
    }
  }
  return out;
}

function parseTable(xml: string): { rows: DocxRun[][][]; widths: number[] } {
  // The author's own column widths, in twentieths of a point. Equal columns
  // would put a label like "Monthly Rent" in the same space as the clause of
  // text beside it, which is not the table anyone laid out.
  const grid = xml.match(/<w:tblGrid>[\s\S]*?<\/w:tblGrid>/)?.[0] || "";
  const widths = (grid.match(/<w:gridCol w:w="(\d+)"/g) || [])
    .map((col) => Number(col.match(/"(\d+)"/)?.[1] || "0"))
    .filter((width) => width > 0);
  const rows: DocxRun[][][] = [];
  // Rows of THIS table only: a nested table's rows would otherwise be pulled up
  // into the outer one. Its text still arrives, flattened into the cell that
  // holds it, which is a fair reading of a layout nobody can reproduce here.
  const rowMatches = xml.match(/<w:tr\b(?![a-zA-Z])[\s\S]*?<\/w:tr>/g) || [];
  for (const row of rowMatches) {
    const cells: DocxRun[][] = [];
    for (const cell of row.match(/<w:tc>[\s\S]*?<\/w:tc>/g) || []) {
      const paragraphs = cell.match(/<w:p\b(?![a-zA-Z])[\s\S]*?<\/w:p>/g) || [];
      const runs: DocxRun[] = [];
      paragraphs.forEach((paragraph, index) => {
        if (index > 0) runs.push({ text: "\n", bold: false });
        runs.push(...parseRuns(paragraph, false));
      });
      cells.push(runs);
    }
    if (cells.length) rows.push(cells);
  }
  return { rows, widths };
}

export function parseDocxBlocks(parts: {
  document: string;
  styles?: string;
  numbering?: string;
}): DocxBlock[] {
  const styles = parseStyles(parts.styles || "");
  const numbering = parseNumbering(parts.numbering || "");
  const body = parts.document.match(/<w:body>[\s\S]*<\/w:body>/)?.[0] || parts.document;

  const counters = new Map<string, number[]>();
  const blocks: DocxBlock[] = [];

  for (const item of topLevelBlocks(body)) {
    if (item.kind === "tbl") {
      const { rows, widths } = parseTable(item.xml);
      if (rows.length) blocks.push({ kind: "table", rows, widths });
      continue;
    }

    const paragraph = item.xml;
    const props = paragraph.match(/<w:pPr>[\s\S]*?<\/w:pPr>/)?.[0] || "";
    const styleId = props.match(/<w:pStyle w:val="([^"]*)"/)?.[1];
    const style = resolveStyle(styles, styleId);

    // An explicit page break is its own block. Word writes it inside a run, and
    // usually in a paragraph that has nothing else in it.
    if (/<w:br[^>]*w:type="page"/.test(paragraph)) {
      blocks.push({ kind: "pageBreak" });
      const runs = parseRuns(paragraph, style.bold ?? false).filter((run) => run.text.trim());
      if (!runs.length) continue;
    }

    const runs = parseRuns(paragraph, style.bold ?? false);
    const text = runs.map((run) => run.text).join("").trim();

    if (style.headingLevel !== undefined && text) {
      blocks.push({ kind: "heading", level: style.headingLevel, runs });
      continue;
    }

    // Numbering from the paragraph first, then from its style: a paragraph that
    // states its own list wins over the one its style would have given it.
    const ownNumPr = props.match(/<w:numPr>[\s\S]*?<\/w:numPr>/)?.[0];
    const numId = ownNumPr?.match(/<w:numId w:val="([^"]*)"/)?.[1] ?? style.numId;
    const ilvl = ownNumPr
      ? Number(ownNumPr.match(/<w:ilvl w:val="([^"]*)"/)?.[1] ?? "0")
      : style.ilvl ?? 0;

    let marker: string | null = null;
    let indent = 0;
    // numId "0" is Word for "this paragraph is explicitly not in a list".
    if (numId && numId !== "0" && text) {
      const levels = numbering.get(numId);
      const level = levels?.get(ilvl);
      if (level) {
        const running = counters.get(numId) || [];
        running[ilvl] = (running[ilvl] ?? level.start - 1) + 1;
        // A new item at this level restarts everything nested under it, which
        // is what makes 1.1, 1.2, then 2.1 rather than 2.3.
        running.length = ilvl + 1;
        counters.set(numId, running);
        marker = renderMarker(level.lvlText, level.numFmt, running, levels!);
        indent = ilvl;
      }
    }

    if (!text) {
      // Keep empty paragraphs: they are the spacing the author put in.
      blocks.push({ kind: "paragraph", runs: [], marker: null, indent: 0 });
      continue;
    }
    blocks.push({ kind: "paragraph", runs, marker, indent });
  }

  return blocks;
}
