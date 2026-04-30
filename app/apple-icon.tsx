import { ImageResponse } from "next/og";

// iOS uses a different convention: `apple-icon.png` at 180x180 with no
// transparency (iOS adds its own rounded mask + drop shadow). Same
// content as `app/icon.tsx`, just sized for the iOS home screen.

export const size = {
  width: 180,
  height: 180,
};

export const contentType = "image/png";

export default function AppleIcon() {
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
