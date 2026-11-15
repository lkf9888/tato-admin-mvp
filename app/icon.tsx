import { ImageResponse } from "next/og";

import { BRAND, brandMarkDataUri } from "@/lib/brand-mark";

// Next file convention: `app/icon` is the browser-tab favicon, and the
// large icon on a web-push notification (public/push-sw.js). Both are
// seen at 32px or less, so this is the single-letter "t" -- the whole
// "tato" blurs at that size. Home screens and launchers get the word
// from `app/apple-icon.tsx` and `app/app-icon.png` (see the manifest).
//
// The drawing is an SVG data URI in an <img>: Satori passes it to resvg
// whole, so strokes, curves and round caps come out exactly as in the
// sidebar instead of being re-built from divs.

export const size = { width: BRAND.box, height: BRAND.box };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
      <img src={brandMarkDataUri({ variant: "t" })} width={size.width} height={size.height} />
    ),
    { ...size },
  );
}
