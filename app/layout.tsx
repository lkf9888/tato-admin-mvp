import type { Metadata, Viewport } from "next";

import "@/app/globals.css";
import { getI18n } from "@/lib/i18n-server";
import { APP_VERSION_LABEL } from "@/lib/version";

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

  return (
    <html lang={locale === "zh" ? "zh-CN" : "en"}>
      <body>
        {children}
        {/* Floating version chip — desktop only. On mobile it would
            collide with the bottom tab bar / iOS home indicator and
            adds nothing useful, so we hide it under `lg`. */}
        <div className="pointer-events-none fixed bottom-3 left-3 z-40 hidden rounded-full border border-[var(--line)] bg-[rgba(255,255,255,0.92)] px-3 py-1.5 text-[11px] font-medium tracking-[0.08em] text-[var(--ink-soft)] shadow-[0_16px_32px_rgba(17,19,24,0.08)] backdrop-blur lg:block">
          {APP_VERSION_LABEL}
        </div>
      </body>
    </html>
  );
}
