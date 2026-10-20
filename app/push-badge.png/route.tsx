import { ImageResponse } from "next/og";

import { BRAND_MARK } from "@/components/brand-mark";

/**
 * The small mark Android shows in the status bar for a push
 * notification (public/push-sw.js). Android draws only its alpha, in
 * white, so it is the brand's T alone, white on transparent -- the full
 * app icon there would be a white square.
 *
 * The same geometry as app/icon.tsx, scaled to 96px, without the tile.
 */
export const dynamic = "force-static";

const SIZE = 96;

export function GET() {
  const { box, bar, stem } = BRAND_MARK;
  const k = SIZE / box;
  return new ImageResponse(
    (
      <div style={{ width: SIZE, height: SIZE, display: "flex", position: "relative" }}>
        <div
          style={{
            position: "absolute",
            left: bar.x * k,
            top: bar.y * k,
            width: bar.width * k,
            height: bar.height * k,
            borderRadius: bar.radius * k,
            background: "#ffffff",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: stem.x * k,
            top: stem.y * k,
            width: stem.width * k,
            height: stem.height * k,
            borderRadius: stem.radius * k,
            background: "#ffffff",
          }}
        />
      </div>
    ),
    { width: SIZE, height: SIZE },
  );
}
