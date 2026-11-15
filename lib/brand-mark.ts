/**
 * The TATO mark's geometry, as SVG markup. Pure, no React, so the
 * same drawing reaches the app (`components/brand-mark.tsx`),
 * `ImageResponse` icons and `scripts/generate-brand-icons.ts`.
 * The design notes live on the component.
 */

export const BRAND = {
  box: 512,
  ink: "#15171C",
  accent: "#FF5A3C",
  paper: "#FFFFFF",
  /** iOS-ish tile corner for places that round their own tile. */
  tileRadius: 114,
} as const;

export type BrandMarkVariant = "word" | "t";

type DrawOptions = {
  variant: BrandMarkVariant;
  /** Fill the 512 box with the dark tile. Off for a mark on a
   *  transparent background (adaptive-icon foregrounds, splash). */
  tile?: boolean;
  /** Corner radius of the tile in the 512 box; 0 for a square the OS
   *  masks itself. */
  radius?: number;
  /** One colour for every stroke, accent included: the push badge
   *  and Android's monochrome icon are alpha-only. */
  mono?: string;
  /** Shrink the mark about the centre. 1 keeps it inside the ~410px
   *  circle a PWA maskable icon may be cropped to; an Android adaptive
   *  icon only shows the middle 61%, so its layers pass ~0.8. */
  scale?: number;
};

/** The word, in its own coordinates: x-height 0..100, stroke centres. */
function wordStrokes(fg: string, accent: string, strokeWidth: number) {
  const s = `stroke="${fg}" stroke-width="${strokeWidth}" stroke-linecap="round" fill="none"`;
  return [
    `<path d="M32 -22V86" ${s}/>`, // t
    `<circle cx="128" cy="50" r="36" ${s}/>`, // a: bowl
    `<path d="M164 14V86" ${s}/>`, // a: stem
    `<path d="M224 -22V86" ${s}/>`, // t
    `<path d="M14 13H242" ${s}/>`, // the shared crossbar
    `<circle cx="320" cy="50" r="36" stroke="${accent}" stroke-width="${strokeWidth}" fill="none"/>`, // o
  ].join("");
}

/** Inner SVG markup (no <svg> wrapper) in a 512 box. */
export function brandMarkInner({ variant, tile = true, radius = 0, mono, scale = 1 }: DrawOptions) {
  const { box, ink, accent, paper } = BRAND;
  const fg = mono ?? paper;
  const hi = mono ?? accent;
  const parts: string[] = [];
  if (tile) parts.push(`<rect width="${box}" height="${box}" rx="${radius}" fill="${ink}"/>`);

  let mark: string;
  if (variant === "word") {
    // Stroke 34 rather than the 28 the letters were drawn at: an icon
    // is seen small, and the heavier stroke is what keeps the bowls of
    // the a and o open at 48px. Word bounds with that stroke: x -3..373,
    // y -39..103, centred here and kept within a 205px radius.
    const k = 0.957 * scale;
    const cx = 185;
    const cy = 32;
    mark = `<g transform="translate(${256 - cx * k} ${256 - cy * k}) scale(${k})">${wordStrokes(fg, hi, 34)}</g>`;
  } else {
    const t = `<path d="M240 118V318Q240 384 306 384H318" stroke="${fg}" stroke-width="64" stroke-linecap="round" fill="none"/><path d="M168 200H344" stroke="${hi}" stroke-width="64" stroke-linecap="round"/>`;
    mark = scale === 1 ? t : `<g transform="translate(${256 * (1 - scale)} ${256 * (1 - scale)}) scale(${scale})">${t}</g>`;
  }
  parts.push(mark);
  return parts.join("");
}

/** A complete SVG document, for ImageResponse and sharp. */
export function brandMarkSvg(options: DrawOptions & { size?: number }) {
  const { box } = BRAND;
  const size = options.size ?? box;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${box} ${box}">${brandMarkInner(options)}</svg>`;
}

/** As an <img src>, for Satori. */
export function brandMarkDataUri(options: DrawOptions & { size?: number }) {
  return `data:image/svg+xml;base64,${Buffer.from(brandMarkSvg(options)).toString("base64")}`;
}

/** The word alone, no tile, at drawing weight (stroke 28): headers and
 *  sign-in pages. `ink` may be "currentColor" so CSS sets it. */
export const BRAND_WORDMARK_VIEWBOX = "-14 -50 398 164";

export function brandWordmarkInner(ink: string) {
  return wordStrokes(ink, BRAND.accent, 28);
}
