import { ImageResponse } from "next/og";

// Next 15 file convention: `app/icon` is served as the PWA icon, also
// linked from the manifest. We render it dynamically with ImageResponse
// instead of shipping a PNG, so the icon stays in sync with the brand
// without anyone having to open Figma.
//
// 192x192 is one of the standard PWA sizes; the manifest lists this
// same endpoint at 192x192 and 512x512 (browsers scale it).

export const size = {
  width: 192,
  height: 192,
};

export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#111318",
          color: "#ffffff",
          fontSize: 96,
          fontWeight: 700,
          letterSpacing: "-0.06em",
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        }}
      >
        T
      </div>
    ),
    {
      ...size,
    },
  );
}
