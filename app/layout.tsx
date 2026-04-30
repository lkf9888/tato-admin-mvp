import type { Metadata } from "next";

import "@/app/globals.css";
import { getI18n } from "@/lib/i18n-server";
import { APP_VERSION_LABEL } from "@/lib/version";

export async function generateMetadata(): Promise<Metadata> {
  const { messages } = await getI18n();

  return {
    title: messages.meta.title,
    description: messages.meta.description,
  };
}

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
        <div className="pointer-events-none fixed bottom-3 left-3 z-50 rounded-full border border-[var(--line)] bg-[rgba(255,255,255,0.92)] px-3 py-1.5 text-[11px] font-medium tracking-[0.08em] text-[var(--ink-soft)] shadow-[0_16px_32px_rgba(17,19,24,0.08)] backdrop-blur">
          {APP_VERSION_LABEL}
        </div>
      </body>
    </html>
  );
}
