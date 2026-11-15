import { ImageResponse } from "next/og";

import { brandMarkDataUri } from "@/lib/brand-mark";

// iOS home screen. 180x180, opaque, square: iOS applies its own mask
// and shadow, so the tile is drawn without corners of our own. A home
// screen icon is big enough for the whole "tato".

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
      <img src={brandMarkDataUri({ variant: "word", size: 180 })} width={180} height={180} />
    ),
    { ...size },
  );
}
