import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { findPublishedSiteBySlug } from "@/lib/rental-site";
import {
  buildSiteVehicleMetadata,
  renderSiteVehicle,
  type SearchParams,
} from "@/lib/rental-site-page";

type Params = Promise<{ slug: string; vehicleSlug: string }>;
type Query = Promise<SearchParams>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug, vehicleSlug } = await params;
  const site = await findPublishedSiteBySlug(slug);
  if (!site) return {};
  return buildSiteVehicleMetadata(site, vehicleSlug);
}

export default async function RentalSiteVehiclePage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Query;
}) {
  const [{ slug, vehicleSlug }, query] = await Promise.all([params, searchParams]);
  const site = await findPublishedSiteBySlug(slug);
  if (!site) notFound();

  return renderSiteVehicle(site, vehicleSlug, query);
}
