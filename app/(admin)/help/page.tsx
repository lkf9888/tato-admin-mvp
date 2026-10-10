import { HelpManual } from "@/components/help-manual";
import { canOpenPath } from "@/lib/access";
import { requireAccessContext } from "@/lib/auth";
import { getI18n } from "@/lib/i18n-server";

import { helpContent, resolveGuides, screenshotSet } from "./guides";

/**
 * The help manual: one guide per page of the app, in sections that cover
 * the page and the dialogs, menus and sub-pages it opens. A section can
 * carry a screenshot with numbered marks on what its steps say to press
 * (app/(admin)/help/shots, taken by scripts/capture-help-screenshots.ts
 * from local demo data, never a real account); both Chinese locales share
 * the Chinese set. A member sees guides only for the pages they can open.
 * Questions go through the Contact button the whole app already has.
 */
export default async function HelpPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const [{ user }, { locale }, params] = await Promise.all([
    requireAccessContext(),
    getI18n(),
    searchParams,
  ]);
  const { copy, guides } = helpContent(locale);
  const visible = resolveGuides(
    guides.filter((guide) => canOpenPath(user, `/${guide.key}`)),
    screenshotSet(locale),
  );
  const initialKey = visible.some((guide) => guide.key === params.page)
    ? params.page!
    : visible[0]?.key ?? "";

  return (
    <HelpManual copy={copy} guides={visible} initialKey={initialKey} />
  );
}
