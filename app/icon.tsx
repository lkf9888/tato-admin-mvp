import { ImageResponse } from "next/og";

import { BRAND_MARK } from "@/components/brand-mark";

// Next 15 file convention: `app/icon` is served as the PWA icon and is
// linked from the manifest, which is in turn what the Android wrapper
// reads its launcher icon from. Rendering it here rather than shipping
// a PNG keeps one drawing behind the sidebar, the home screen and the
// APK.
//
// 512 rather than the 192 this used to be: the manifest lists this
// endpoint at both sizes, and an Android launcher asking for 512 was
// getting a 192 upscaled.
//
// Drawn with divs, not SVG. Satori -- what ImageResponse renders with
// -- covers the box model far more completely than it covers paths, so
// the accent tail is a second box butted against the first rather than
// the path the React component uses. `BRAND_MARK` is the shared
// geometry that keeps the two in step.

export const size = { width: BRAND_MARK.box, height: BRAND_MARK.box };
export const contentType = "image/png";

export default function Icon() {
  const { box, ink, accent, bar, split, stem } = BRAND_MARK;
  const barEnd = bar.x + bar.width;

  return new ImageResponse(
    (
      <div
        style={{
          width: box,
          height: box,
          display: "flex",
          position: "relative",
          background: ink,
        }}
      >
        {/* Crossbar, up to the stem's right edge. Rounded on the left
            only: the right end is a butt joint with the accent. */}
        <div
          style={{
            position: "absolute",
            left: bar.x,
            top: bar.y,
            width: split - bar.x,
            height: bar.height,
            background: "#FFFFFF",
            borderRadius: `${bar.radius}px 0 0 ${bar.radius}px`,
          }}
        />
        {/* The next booking along, in the accent. */}
        <div
          style={{
            position: "absolute",
            left: split,
            top: bar.y,
            width: barEnd - split,
            height: bar.height,
            background: accent,
            borderRadius: `0 ${bar.radius}px ${bar.radius}px 0`,
          }}
        />
        {/* Stem. Its top sits inside the crossbar, so the two merge
            into one letter instead of stacking as two shapes. */}
        <div
          style={{
            position: "absolute",
            left: stem.x,
            top: stem.y,
            width: stem.width,
            height: stem.height,
            background: "#FFFFFF",
            borderRadius: stem.radius,
          }}
        />
      </div>
    ),
    { ...size },
  );
}
