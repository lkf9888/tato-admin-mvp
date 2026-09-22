import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { isAdminAuthenticated } from "@/lib/auth";
import { getSiteForCurrentRequest } from "@/lib/rental-site";
import {
  buildSiteHomeMetadata,
  renderSiteHome,
  type SearchParams,
} from "@/lib/rental-site-page";

/**
 * The root, which is two different things depending on who asked.
 *
 * On a custom domain bound to a published rental site, this is that
 * site's front page. On the platform host it is what it has always
 * been: a doorway into the admin app.
 *
 * The decision is made here rather than in `middleware.ts` because
 * middleware runs on the Edge runtime, where Prisma is unavailable and
 * `process.env` is inlined at build time -- and this image is built in
 * Docker without any of the deployment's environment, so a host
 * allow-list read there would compile to `undefined` and match
 * nothing.
 */

export async function generateMetadata(): Promise<Metadata> {
  const site = await getSiteForCurrentRequest();
  return site ? buildSiteHomeMetadata(site) : {};
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const site = await getSiteForCurrentRequest();
  if (site) {
    return renderSiteHome(site, await searchParams);
  }

  const authenticated = await isAdminAuthenticated();
  redirect(authenticated ? "/dashboard" : "/login");
}
