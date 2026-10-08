import type { Metadata, Viewport } from "next";

import { cookies, headers } from "next/headers";

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
      // Dark status-bar text on the white top bar. "black-translucent"
      // drew white clock and battery icons straight onto that white bar,
      // where they could not be seen.
      statusBarStyle: "default",
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
  // The browser's own bar matches the white top bar under it, rather
  // than a near-black strip above a white page.
  themeColor: "#ffffff",
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
  const [{ locale }, requestHeaders, cookieStore] = await Promise.all([getI18n(), headers(), cookies()]);
  // Public rental-site pages take their language from the URL, which
  // middleware reads for us; everything else follows the admin's own
  // preference.
  const siteLang = requestHeaders.get("x-site-lang");
  const lang =
    siteLang && /^(?:en|zh-Hans|zh-Hant)$/.test(siteLang)
      ? siteLang
      : locale === "zh"
        ? "zh-CN"
        : locale === "zh-Hant"
          ? "zh-Hant"
          : "en";

  // The previous floating version chip pinned at `bottom-3 left-3` was
  // removed in v0.19.5 — on mobile it sat directly under the
  // ContactButton (also bottom-left) and the two overlapped, and on
  // desktop the version is already prominent in the sidebar's footer
  // block. Keeping it in two places was clutter for no information
  // gain.
  // The admin's appearance choice (account settings). Not on the public
  // rental site, which keeps its own light theme for renters.
  const themeChoice = cookieStore.get("tato-theme")?.value;
  const theme = !siteLang && (themeChoice === "dark" || themeChoice === "system") ? themeChoice : undefined;

  return (
    <html lang={lang} data-theme={theme}>
      <body>{children}</body>
    </html>
  );
}
