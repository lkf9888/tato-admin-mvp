/**
 * Draws the one-page estimate report onto a canvas, in PDF points.
 *
 * Canvas rather than pdf-lib's own text API, for one reason: fonts.
 * pdf-lib's standard fonts are Latin-1 only — `lib/contract-documents.ts`
 * runs every string through a `toWinAnsi` filter that turns anything
 * outside that range into "?", so a Chinese contract renders as rows of
 * question marks. This report goes to owners who mostly read Chinese,
 * so that is not an option, and the alternative — embedding a CJK font —
 * means shipping ~10MB of Noto in the repo and the Docker image.
 *
 * The browser already has the fonts. Drawing to a canvas and embedding
 * the bitmap costs selectable text, which a one-page leave-behind does
 * not need, and buys correct rendering in every language the app speaks
 * for zero bytes of dependency.
 *
 * Everything is laid out in PDF points (Letter, 612x792) and rendered at
 * `SCALE` times that, so the caller can drop the bitmap straight onto a
 * page with no coordinate conversion.
 */
import type { Locale } from "@/lib/i18n";

import type { VehicleEstimate } from "./index";

export const PAGE_WIDTH = 612;
export const PAGE_HEIGHT = 792;
/** 3x Letter ≈ 216 DPI — sharp in a viewer and on paper. */
const SCALE = 3;
const MARGIN = 48;
const CONTENT = PAGE_WIDTH - MARGIN * 2;

// Literal rather than read off CSS custom properties: the report should
// look the same whoever exports it, and a canvas has no cascade to
// inherit from anyway.
const INK = "#121214";
const INK_MID = "#414143";
const INK_SOFT = "#6e6e73";
const LINE = "#e7e7e8";
const BRAND = "#593cfb";
const BRAND_SOFT = "#efecff";
const BAR_TRACK = "#e9e5ff";

const SANS =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", Roboto, sans-serif';

export type ReportCopy = {
  reportTitle: string;
  vehicleValueLabel: string;
  headlineLabel: string;
  headlineRange: string;
  netLabel: string;
  grossLabel: string;
  commissionLabel: string;
  chartTitle: string;
  statPeak: string;
  statTrough: string;
  statAverage: string;
  evidenceTitle: string;
  evidenceBody: string;
  basis: string;
  assumptionsTitle: string;
  assumptions: string[];
  generatedAt: string;
};

function font(size: number, weight: 400 | 600 | 700 = 400) {
  return `${weight} ${size}px ${SANS}`;
}

/** Draw `text`, wrapped to `maxWidth`; returns the y below the block. */
function paragraph(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
) {
  // Break on spaces where there are any, and per-character otherwise —
  // Chinese has no inter-word spaces, so a word-only wrap would run a
  // whole sentence off the right edge.
  const tokens = /\s/.test(text.trim()) ? text.split(/(\s+)/) : [...text];
  let line = "";
  let cursor = y;
  for (const token of tokens) {
    const candidate = line + token;
    if (ctx.measureText(candidate).width > maxWidth && line) {
      ctx.fillText(line.trimEnd(), x, cursor);
      cursor += lineHeight;
      line = token.trimStart();
    } else {
      line = candidate;
    }
  }
  if (line.trim()) {
    ctx.fillText(line.trimEnd(), x, cursor);
    cursor += lineHeight;
  }
  return cursor;
}

function rule(ctx: CanvasRenderingContext2D, y: number) {
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 0.75;
  ctx.beginPath();
  ctx.moveTo(MARGIN, y);
  ctx.lineTo(PAGE_WIDTH - MARGIN, y);
  ctx.stroke();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function drawReport(options: {
  estimate: VehicleEstimate;
  copy: ReportCopy;
  locale: Locale;
  commission: number;
  monthLabel: (month: number, year: number) => string;
  currency: (value: number) => string;
}): HTMLCanvasElement {
  const { estimate, copy, commission, monthLabel, currency } = options;
  const ownerShare = 1 - commission / 100;

  const canvas = document.createElement("canvas");
  canvas.width = PAGE_WIDTH * SCALE;
  canvas.height = PAGE_HEIGHT * SCALE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.scale(SCALE, SCALE);
  ctx.textBaseline = "alphabetic";

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);

  // ---- header -------------------------------------------------------
  ctx.fillStyle = BRAND;
  ctx.font = font(13, 700);
  ctx.fillText("TATO", MARGIN, 58);

  ctx.fillStyle = INK_SOFT;
  ctx.font = font(8);
  ctx.textAlign = "right";
  ctx.fillText(copy.generatedAt, PAGE_WIDTH - MARGIN, 58);
  ctx.textAlign = "left";

  ctx.fillStyle = INK;
  ctx.font = font(19, 700);
  ctx.fillText(copy.reportTitle, MARGIN, 90);

  ctx.fillStyle = INK_MID;
  ctx.font = font(12, 600);
  ctx.fillText(`${estimate.year} ${estimate.make} ${estimate.model}`, MARGIN, 111);

  ctx.fillStyle = INK_SOFT;
  ctx.font = font(9);
  ctx.fillText(`${copy.vehicleValueLabel} ${currency(estimate.value)}`, MARGIN, 127);

  rule(ctx, 145);

  // ---- headline -----------------------------------------------------
  ctx.fillStyle = INK_SOFT;
  ctx.font = font(8, 600);
  ctx.fillText(copy.headlineLabel.toUpperCase(), MARGIN, 170);

  ctx.fillStyle = INK;
  ctx.font = font(33, 700);
  ctx.fillText(currency(estimate.annualGross), MARGIN, 203);

  ctx.fillStyle = INK_SOFT;
  ctx.font = font(9);
  ctx.fillText(
    copy.headlineRange
      .replace("{low}", currency(estimate.annualLow))
      .replace("{high}", currency(estimate.annualHigh)),
    MARGIN,
    219,
  );

  // owner's share, boxed
  const boxW = 176;
  const boxX = PAGE_WIDTH - MARGIN - boxW;
  ctx.fillStyle = BRAND_SOFT;
  roundRect(ctx, boxX, 155, boxW, 66, 6);
  ctx.fill();

  ctx.fillStyle = BRAND;
  ctx.font = font(8, 600);
  ctx.fillText(copy.netLabel.toUpperCase(), boxX + 14, 176);
  ctx.font = font(24, 700);
  ctx.fillText(currency(estimate.annualGross * ownerShare), boxX + 14, 203);
  ctx.fillStyle = INK_SOFT;
  ctx.font = font(8);
  ctx.fillText(`${copy.commissionLabel} ${commission}%`, boxX + 14, 216);

  rule(ctx, 241);

  // ---- chart --------------------------------------------------------
  ctx.fillStyle = INK;
  ctx.font = font(11, 600);
  ctx.fillText(copy.chartTitle, MARGIN, 262);

  // legend
  let legendX = MARGIN;
  const legendY = 278;
  for (const [label, colour] of [
    [copy.netLabel, BRAND],
    [copy.grossLabel, BAR_TRACK],
  ] as const) {
    ctx.fillStyle = colour;
    roundRect(ctx, legendX, legendY - 6, 7, 7, 1.5);
    ctx.fill();
    ctx.fillStyle = INK_SOFT;
    ctx.font = font(8);
    ctx.fillText(label, legendX + 12, legendY);
    legendX += 12 + ctx.measureText(label).width + 18;
  }

  const chartTop = 296;
  const chartBottom = 432;
  const chartHeight = chartBottom - chartTop;
  const gap = 7;
  const barWidth = (CONTENT - gap * 11) / 12;
  const maxGross = Math.max(...estimate.months.map((m) => m.gross));

  estimate.months.forEach((month, index) => {
    const x = MARGIN + index * (barWidth + gap);
    const total = (month.gross / maxGross) * chartHeight;
    const net = total * ownerShare;

    ctx.fillStyle = BAR_TRACK;
    roundRect(ctx, x, chartBottom - total, barWidth, total, 2);
    ctx.fill();

    ctx.fillStyle = BRAND;
    roundRect(ctx, x, chartBottom - net, barWidth, net, 2);
    ctx.fill();

    ctx.fillStyle = INK_MID;
    ctx.font = font(7, 600);
    ctx.textAlign = "center";
    ctx.fillText(currency(month.gross), x + barWidth / 2, chartBottom - total - 5);

    ctx.fillStyle = INK_SOFT;
    ctx.font = font(7.5);
    ctx.fillText(monthLabel(month.month, month.year), x + barWidth / 2, chartBottom + 13);
    ctx.textAlign = "left";
  });

  rule(ctx, 452);

  // ---- three stats --------------------------------------------------
  const stats: Array<[string, string, string]> = [
    [
      copy.statPeak,
      currency(estimate.peak.gross),
      monthLabel(estimate.peak.month, estimate.peak.year),
    ],
    [
      copy.statTrough,
      currency(estimate.trough.gross),
      monthLabel(estimate.trough.month, estimate.trough.year),
    ],
    [
      copy.statAverage,
      currency(estimate.averageMonthlyGross),
      `${currency(estimate.averageMonthlyGross * ownerShare)} · ${copy.netLabel}`,
    ],
  ];
  const colWidth = CONTENT / 3;
  stats.forEach(([label, value, foot], index) => {
    const x = MARGIN + index * colWidth;
    ctx.fillStyle = INK_SOFT;
    ctx.font = font(8, 600);
    ctx.fillText(label.toUpperCase(), x, 476);
    ctx.fillStyle = index === 0 ? BRAND : INK;
    ctx.font = font(17, 700);
    ctx.fillText(value, x, 498);
    ctx.fillStyle = INK_SOFT;
    ctx.font = font(8);
    ctx.fillText(foot, x, 512);
  });

  rule(ctx, 532);

  // ---- evidence + basis ---------------------------------------------
  let y = 554;
  ctx.fillStyle = INK;
  ctx.font = font(9.5, 600);
  ctx.fillText(copy.evidenceTitle, MARGIN, y);
  y += 15;
  ctx.fillStyle = INK_SOFT;
  ctx.font = font(8.5);
  y = paragraph(ctx, copy.evidenceBody, MARGIN, y, CONTENT, 12);

  y += 10;
  ctx.fillStyle = INK_MID;
  ctx.font = font(8.5);
  y = paragraph(ctx, copy.basis, MARGIN, y, CONTENT, 12);

  // ---- assumptions ---------------------------------------------------
  y += 12;
  ctx.fillStyle = INK;
  ctx.font = font(9.5, 600);
  ctx.fillText(copy.assumptionsTitle, MARGIN, y);
  y += 15;
  ctx.font = font(8);
  for (const item of copy.assumptions) {
    ctx.fillStyle = LINE;
    ctx.beginPath();
    ctx.arc(MARGIN + 2, y - 3, 1.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = INK_SOFT;
    y = paragraph(ctx, item, MARGIN + 10, y, CONTENT - 10, 11) + 3;
  }

  // ---- footer --------------------------------------------------------
  rule(ctx, PAGE_HEIGHT - 56);
  ctx.fillStyle = INK_SOFT;
  ctx.font = font(7.5);
  ctx.fillText("TATO · tatocar.co", MARGIN, PAGE_HEIGHT - 40);

  return canvas;
}
