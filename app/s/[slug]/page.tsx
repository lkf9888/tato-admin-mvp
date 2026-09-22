import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { findPublishedSiteBySlug } from "@/lib/rental-site";
import {
  buildSiteHomeMetadata,
  renderSiteHome,
  type SearchParams,
} from "@/lib/rental-site-page";

/**
 * A rental site at its platform address.
 *
 * This is what an operator has before they own a domain, and what they
 * still have when their DNS is broken at 2am. It renders exactly what
 * the custom domain renders.
 */

type Params = Promise<{ slug: string }>;
type Query = Promise<SearchParams>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const site = await findPublishedSiteBySlug(slug);
  if (!site) return {};
  return buildSiteHomeMetadata(site);
}

export default async function RentalSiteHomePage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Query;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const site = await findPublishedSiteBySlug(slug);
  if (!site) notFound();

  return renderSiteHome(site, query);
}
