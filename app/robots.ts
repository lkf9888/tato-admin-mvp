import type { MetadataRoute } from "next";

import { getSiteForCurrentRequest, getSiteUrl } from "@/lib/rental-site";

export const dynamic = "force-dynamic";

/**
 * Two hosts, two answers.
 *
 * On a rental site's own domain, everything a renter sees is meant to
 * be found, and nothing else is. On the platform host the situation is
 * inverted: it is an admin application whose only intentionally public
 * page is a shared booking link, so the rule is an allow-list. A
 * deny-list there would silently expose the next admin page somebody
 * adds.
 *
 * `/s/` is closed on both. A site reachable at both its domain and its
 * platform address would be two copies of the same listings competing
 * in the same results; the domain is the one being advertised, so the
 * preview address stays out.
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const site = await getSiteForCurrentRequest();

  if (site) {
    return {
      rules: [
        {
          userAgent: "*",
          // Car photos and the logo are served from under /api/. They
          // are what the pages show and what the structured data points
          // at, so they are carved out of the /api/ block -- the longer
          // match wins in robots.txt.
          allow: ["/", "/api/direct-booking/vehicles/", "/api/rental-site/logo"],
          disallow: ["/api/", "/s/", "/login", "/register", "/share/", "/sign/", "/staff-share/"],
        },
      ],
      sitemap: `${getSiteUrl(site, "")}/sitemap.xml`,
    };
  }

  return {
    rules: [
      {
        userAgent: "*",
        // Token-addressed pages (/share, /sign, /staff-share) are secret
        // by URL; /reserve is the one page meant for strangers.
        allow: "/reserve/",
        disallow: "/",
      },
    ],
  };
}
