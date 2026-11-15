import { ImageResponse } from "next/og";

import { brandMarkDataUri } from "@/lib/brand-mark";

/**
 * The small mark Android shows in the status bar for a push
 * notification (public/push-sw.js). Android draws only its alpha, in
 * white, so it is the brand's lowercase t alone, white on transparent
 * -- the full app icon there would be a white square.
 */
export const dynamic = "force-static";

const SIZE = 96;

export function GET() {
  return new ImageResponse(
    (
      // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
      <img
        src={brandMarkDataUri({ variant: "t", tile: false, mono: "#ffffff", scale: 1.25, size: SIZE })}
        width={SIZE}
        height={SIZE}
      />
    ),
    { width: SIZE, height: SIZE },
  );
}
