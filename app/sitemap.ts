import type { MetadataRoute } from "next";

import { getSiteFleet, getSiteForCurrentRequest, getSiteUrl } from "@/lib/rental-site";

export const dynamic = "force-dynamic";

/**
 * A rental site's pages, for the crawler that asked.
 *
 * Empty on the platform host: an admin application has nothing to
 * submit, and a sitemap listing its login page is worse than none.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const site = await getSiteForCurrentRequest();
  if (!site) return [];

  const fleet = await getSiteFleet({ workspaceId: site.workspaceId });
  const now = new Date();

  return [
    {
      url: getSiteUrl(site, "/"),
      lastModified: site.updatedAt,
      changeFrequency: "daily",
      priority: 1,
    },
    ...fleet.map((vehicle) => ({
      url: getSiteUrl(site, `/cars/${vehicle.slug}`),
      lastModified: now,
      changeFrequency: "daily" as const,
      priority: 0.8,
    })),
  ];
}
