import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { LegalDocumentView } from "@/components/legal-document";
import { getI18n } from "@/lib/i18n-server";
import { getPlatformLegalPage, isLegalDoc, LEGAL_DOCS } from "@/lib/legal";
import { getSiteForCurrentRequest } from "@/lib/rental-site";
import { domainLegalRoute } from "@/lib/site-routes";

/**
 * `/legal/privacy` and `/legal/terms`: on a rental site's own domain,
 * that site's pages for renters; on the platform host, TATO's own pages
 * for operators -- the privacy policy Google's review of mailbox access
 * asks for, among others. The same split as the root page.
 */

type Params = Promise<{ doc: string }>;

const siteRoute = domainLegalRoute("en");

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  if (await getSiteForCurrentRequest()) return siteRoute.generateMetadata({ params });
  const { doc } = await params;
  if (!isLegalDoc(doc)) return {};
  const { locale } = await getI18n();
  const page = getPlatformLegalPage(doc, locale);
  return { title: `${page.document.title} | TATO`, robots: page.draft ? { index: false } : undefined };
}

export default async function LegalPage({ params }: { params: Params }) {
  if (await getSiteForCurrentRequest()) return siteRoute.Page({ params });
  const { doc } = await params;
  if (!isLegalDoc(doc)) notFound();
  const { locale, messages } = await getI18n();
  const page = getPlatformLegalPage(doc, locale);
  const copy = messages.legal;
  return (
    <div className="min-h-screen bg-[var(--surface-muted)]">
      <header className="border-b border-[var(--line)] bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3 sm:px-6">
          <Link href="/" className="text-[15px] font-bold text-[var(--ink)]">
            TATO
          </Link>
          <nav className="flex gap-4 text-[13px] text-[var(--ink-mid)]">
            {LEGAL_DOCS.map((each) => (
              <Link key={each} href={`/legal/${each}`} className={each === doc ? "font-semibold text-[var(--ink)]" : ""}>
                {each === "privacy" ? copy.privacyLink : copy.termsLink}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <div className="bg-white">
        <LegalDocumentView page={page} copy={copy} translated={locale !== "en"} />
      </div>
    </div>
  );
}
