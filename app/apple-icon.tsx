import { ImageResponse } from "next/og";

import { BRAND_MARK } from "@/components/brand-mark";

// iOS wants 180x180 with no transparency and no corner rounding of our
// own -- it applies its own mask and shadow. Same drawing as
// `app/icon.tsx`, scaled: the geometry is authored in a 512 box, so
// everything is multiplied by 180/512 rather than re-derived, which is
// how the two icons stay the same logo.

const SCALE = 180 / BRAND_MARK.box;
const px = (value: number) => Math.round(value * SCALE);

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  const { ink, accent, bar, split, stem } = BRAND_MARK;
  const barEnd = bar.x + bar.width;

  return new ImageResponse(
    (
      <div
        style={{
          width: size.width,
          height: size.height,
          display: "flex",
          position: "relative",
          background: ink,
        }}
      >
        <div
          style={{
            position: "absolute",
            left: px(bar.x),
            top: px(bar.y),
            width: px(split - bar.x),
            height: px(bar.height),
            background: "#FFFFFF",
            borderRadius: `${px(bar.radius)}px 0 0 ${px(bar.radius)}px`,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: px(split),
            top: px(bar.y),
            width: px(barEnd - split),
            height: px(bar.height),
            background: accent,
            borderRadius: `0 ${px(bar.radius)}px ${px(bar.radius)}px 0`,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: px(stem.x),
            top: px(stem.y),
            width: px(stem.width),
            height: px(stem.height),
            background: "#FFFFFF",
            borderRadius: px(stem.radius),
          }}
        />
      </div>
    ),
    { ...size },
  );
}
