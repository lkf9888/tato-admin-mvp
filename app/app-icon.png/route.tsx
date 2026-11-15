import { ImageResponse } from "next/og";

import { BRAND, brandMarkDataUri } from "@/lib/brand-mark";

/**
 * The PWA icon the manifest points Android and desktop installs at:
 * the whole "tato" on its square dark tile, 512px. `app/icon` stays the
 * single "t" because it is also the browser-tab favicon, where four
 * letters blur.
 *
 * Square and full-bleed so it can serve as `maskable` too: the word sits
 * inside the 40%-radius circle a launcher may crop a maskable icon to.
 */
export const dynamic = "force-static";

export function GET() {
  const { box } = BRAND;
  return new ImageResponse(
    (
      // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
      <img src={brandMarkDataUri({ variant: "word" })} width={box} height={box} />
    ),
    { width: box, height: box },
  );
}
