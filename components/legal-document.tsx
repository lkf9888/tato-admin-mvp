import type { LegalPage } from "@/lib/legal";

/**
 * One legal page's text, for a rental site or for TATO itself. The
 * chrome around it (the site's shell, or TATO's plain header) is the
 * caller's.
 */
export function LegalDocumentView({
  page,
  copy,
  translated,
}: {
  page: LegalPage;
  copy: { effective: (date: string) => string; draftBanner: string; governingNote: string };
  /** Not English: say which text governs. */
  translated: boolean;
}) {
  const { document } = page;
  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
      {page.draft ? (
        <p className="mb-6 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] leading-5 text-amber-900">
          {copy.draftBanner}
        </p>
      ) : null}
      <h1 className="text-2xl font-semibold text-[var(--ink)] sm:text-3xl">{document.title}</h1>
      <p className="mt-2 text-[12px] text-[var(--ink-soft)]">{copy.effective(page.effectiveDate)}</p>
      <p className="mt-5 text-[14px] leading-7 text-[var(--ink-mid)]">{document.intro}</p>
      {document.sections.map((section) => (
        <section key={section.heading} className="mt-7">
          <h2 className="text-[16px] font-semibold text-[var(--ink)]">{section.heading}</h2>
          {section.body.map((paragraph) => (
            <p key={paragraph} className="mt-2 text-[14px] leading-7 text-[var(--ink-mid)]">
              {paragraph}
            </p>
          ))}
        </section>
      ))}
      {translated ? <p className="mt-8 text-[12px] text-[var(--ink-soft)]">{copy.governingNote}</p> : null}
    </main>
  );
}
