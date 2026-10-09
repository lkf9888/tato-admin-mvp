import { HelpManual } from "@/components/help-manual";
import { canOpenPath } from "@/lib/access";
import { requireAccessContext } from "@/lib/auth";
import { getI18n } from "@/lib/i18n-server";

import { helpContent, screenshotSet } from "./guides";

/**
 * The help manual: one guide per page of the app, each with a screenshot
 * of that page, numbered steps that quote its own buttons, and the rules
 * that are not obvious from the screen.
 *
 * The screenshots are of the local demo data, never a real account --
 * renters' names and phones have no business in a manual -- and live at
 * public/help/pages/<zh|en>/<key>.jpg. Both Chinese locales share the
 * Chinese set. A member sees guides only for the pages they can open.
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
  const visible = guides.filter((guide) => canOpenPath(user, `/${guide.key}`));
  const initialKey = visible.some((guide) => guide.key === params.page)
    ? params.page!
    : visible[0]?.key ?? "";

  return (
    <HelpManual copy={copy} guides={visible} shotSet={screenshotSet(locale)} initialKey={initialKey} />
  );
}
