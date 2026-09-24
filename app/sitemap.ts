import type { MetadataRoute } from "next";

import { getSiteFleet, getSiteForCurrentRequest, getSiteUrl } from "@/lib/rental-site";
import { SITE_LOCALES, getSiteHreflang } from "@/lib/site-locale";

export const dynamic = "force-dynamic";

/**
 * A rental site's pages, for the crawler that asked.
 *
 * Every page in every language, each entry naming its siblings -- the
 * sitemap form of hreflang, which Google reads even when it has not
 * crawled the page's own `<link rel="alternate">` tags yet.
 *
 * Empty on the platform host: an admin application has nothing to
 * submit, and a sitemap listing its login page is worse than none.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const site = await getSiteForCurrentRequest();
  if (!site) return [];

  const fleet = await getSiteFleet({ workspaceId: site.workspaceId });
  const now = new Date();

  const pages: Array<{ path: string; lastModified: Date; priority: number }> = [
    { path: "/", lastModified: site.updatedAt, priority: 1 },
    ...fleet.map((vehicle) => ({
      path: `/cars/${vehicle.slug}`,
      lastModified: now,
      priority: 0.8,
    })),
  ];

  return pages.flatMap((page) => {
    const languages = Object.fromEntries(
      SITE_LOCALES.map((locale) => [getSiteHreflang(locale), getSiteUrl(site, page.path, undefined, locale)]),
    );
    return SITE_LOCALES.map((locale) => ({
      url: getSiteUrl(site, page.path, undefined, locale),
      lastModified: page.lastModified,
      changeFrequency: "daily" as const,
      priority: page.priority,
      alternates: { languages },
    }));
  });
}
