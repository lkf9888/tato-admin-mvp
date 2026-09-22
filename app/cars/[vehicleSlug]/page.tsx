import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getSiteForCurrentRequest } from "@/lib/rental-site";
import {
  buildSiteVehicleMetadata,
  renderSiteVehicle,
  type SearchParams,
} from "@/lib/rental-site-page";

/**
 * A car on a site's own domain.
 *
 * Only reachable when the request's Host resolves to a published site,
 * so this path is a 404 on the platform host rather than a second,
 * brandless copy of every listing competing with the real one in
 * search results.
 */

type Params = Promise<{ vehicleSlug: string }>;
type Query = Promise<SearchParams>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const site = await getSiteForCurrentRequest();
  if (!site) return {};
  const { vehicleSlug } = await params;
  return buildSiteVehicleMetadata(site, vehicleSlug);
}

export default async function SiteDomainVehiclePage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Query;
}) {
  const site = await getSiteForCurrentRequest();
  if (!site) notFound();

  const [{ vehicleSlug }, query] = await Promise.all([params, searchParams]);
  return renderSiteVehicle(site, vehicleSlug, query);
}
