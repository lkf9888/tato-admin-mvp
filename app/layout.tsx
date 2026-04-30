import type { Metadata, Viewport } from "next";

import "@/app/globals.css";
import { getI18n } from "@/lib/i18n-server";

export async function generateMetadata(): Promise<Metadata> {
  const { messages } = await getI18n();

  return {
    title: messages.meta.title,
    description: messages.meta.description,
    // App-like behavior when added to the iOS home screen — strips the
    // Safari chrome and lets us draw under the notch / Dynamic Island
    // via `viewport-fit=cover` (declared in `viewport` below).
    appleWebApp: {
      capable: true,
      title: "TATO",
      statusBarStyle: "black-translucent",
    },
    formatDetection: {
      telephone: false,
    },
  };
}

// Separate from generateMetadata per Next 15 — these go into the
// <meta name="viewport"> and <meta name="theme-color"> tags.
// `viewport-fit=cover` is what lets safe-area-inset-* env vars actually
// hold non-zero values on iOS, so the bottom tab bar can sit above the
// home indicator instead of behind it.
export const viewport: Viewport = {
  themeColor: "#111318",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { locale } = await getI18n();

  // The previous floating version chip pinned at `bottom-3 left-3` was
  // removed in v0.19.5 — on mobile it sat directly under the
  // ContactButton (also bottom-left) and the two overlapped, and on
  // desktop the version is already prominent in the sidebar's footer
  // block. Keeping it in two places was clutter for no information
  // gain.
  return (
    <html lang={locale === "zh" ? "zh-CN" : "en"}>
      <body>{children}</body>
    </html>
  );
}
