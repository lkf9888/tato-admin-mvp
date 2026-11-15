/**
 * The TATO mark.
 *
 * A lowercase "tato" drawn from round-capped strokes rather than set in
 * a font, so it looks the same in a sidebar, a launcher and a PNG made
 * on a server with no fonts installed. The two t's share one crossbar
 * -- a road, or a run of bookings on the calendar -- and the final "o"
 * carries the accent, like a wheel.
 *
 * It replaced a purple "T" in v1.91.0. That purple was all but Turo's
 * own, and TATO is a tool for Turo hosts: a mark that reads as Turo's
 * invites being taken for Turo, so neither the shape nor the colour is
 * theirs any more.
 *
 * Two forms, chosen by size:
 *  - "word": the whole "tato" on its dark tile. App icons -- home
 *    screen, launcher, PWA, the install guide's home-screen preview.
 *  - "t": one lowercase t, accent crossbar. Everywhere at 32px or less
 *    (sidebar, browser tab, push badge), where four letters blur.
 *
 * The drawing is plain SVG markup from one function, because the same
 * geometry has to reach React, `ImageResponse` (as an <img> data URI,
 * which Satori hands to resvg whole) and `sharp` for the Android and
 * Expo PNGs (`scripts/generate-brand-icons.ts`) -- it lives in
 * `lib/brand-mark.ts`. One source is what
 * keeps the sidebar, the browser tab and the launcher one logo.
 */

import {
  BRAND,
  BRAND_WORDMARK_VIEWBOX,
  brandMarkInner,
  brandWordmarkInner,
  type BrandMarkVariant,
} from "@/lib/brand-mark";

export function BrandMark({
  size = 32,
  variant = "t",
  className,
}: {
  size?: number;
  variant?: BrandMarkVariant;
  className?: string;
}) {
  const { box, tileRadius } = BRAND;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${box} ${box}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="TATO"
      dangerouslySetInnerHTML={{ __html: brandMarkInner({ variant, radius: tileRadius }) }}
    />
  );
}

/** The word on its own, for headers and sign-in pages. The letters take
 *  the text colour; the o keeps the accent. */
export function BrandWordmark({ className, label = "TATO" }: { className?: string; label?: string }) {
  return (
    <svg
      viewBox={BRAND_WORDMARK_VIEWBOX}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label={label}
      dangerouslySetInnerHTML={{ __html: brandWordmarkInner("currentColor") }}
    />
  );
}
