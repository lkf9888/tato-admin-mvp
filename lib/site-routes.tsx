import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { findPublishedSiteBySlug, getSiteForCurrentRequest } from "@/lib/rental-site";
import {
  buildSiteHomeMetadata,
  buildSiteVehicleMetadata,
  renderSiteHome,
  renderSiteVehicle,
  type SearchParams,
} from "@/lib/rental-site-page";
import type { SiteLocale } from "@/lib/site-locale";

/**
 * Route handlers for a rental site's public pages, one per address and
 * language.
 *
 * Next wants a file per path, and a site has twelve: home and car page,
 * on its own domain or at `/s/<slug>`, in three languages. Each of those
 * files is two lines that call one of these with its language, so the
 * way a page is found and rendered is written once.
 *
 * Domain routes only answer when the Host is a published site's domain,
 * so on the platform host `/zh-CN/cars/…` is a 404 rather than a
 * brandless copy of a listing competing with the real one in search.
 */

type SlugParams = Promise<{ slug: string }>;
type SlugVehicleParams = Promise<{ slug: string; vehicleSlug: string }>;
type VehicleParams = Promise<{ vehicleSlug: string }>;
type Query = Promise<SearchParams>;

export function domainHomeRoute(locale: SiteLocale) {
  return {
    async generateMetadata(): Promise<Metadata> {
      const site = await getSiteForCurrentRequest();
      return site ? buildSiteHomeMetadata(site, locale) : {};
    },
    async Page({ searchParams }: { searchParams: Query }) {
      const site = await getSiteForCurrentRequest();
      if (!site) notFound();
      return renderSiteHome(site, await searchParams, locale);
    },
  };
}

export function domainVehicleRoute(locale: SiteLocale) {
  return {
    async generateMetadata({ params }: { params: VehicleParams }): Promise<Metadata> {
      const site = await getSiteForCurrentRequest();
      if (!site) return {};
      const { vehicleSlug } = await params;
      return buildSiteVehicleMetadata(site, vehicleSlug, locale);
    },
    async Page({ params, searchParams }: { params: VehicleParams; searchParams: Query }) {
      const site = await getSiteForCurrentRequest();
      if (!site) notFound();
      const [{ vehicleSlug }, query] = await Promise.all([params, searchParams]);
      return renderSiteVehicle(site, vehicleSlug, query, locale);
    },
  };
}

export function slugHomeRoute(locale: SiteLocale) {
  return {
    async generateMetadata({ params }: { params: SlugParams }): Promise<Metadata> {
      const site = await findPublishedSiteBySlug((await params).slug);
      return site ? buildSiteHomeMetadata(site, locale) : {};
    },
    async Page({ params, searchParams }: { params: SlugParams; searchParams: Query }) {
      const [{ slug }, query] = await Promise.all([params, searchParams]);
      const site = await findPublishedSiteBySlug(slug);
      if (!site) notFound();
      return renderSiteHome(site, query, locale);
    },
  };
}

export function slugVehicleRoute(locale: SiteLocale) {
  return {
    async generateMetadata({ params }: { params: SlugVehicleParams }): Promise<Metadata> {
      const { slug, vehicleSlug } = await params;
      const site = await findPublishedSiteBySlug(slug);
      return site ? buildSiteVehicleMetadata(site, vehicleSlug, locale) : {};
    },
    async Page({
      params,
      searchParams,
    }: {
      params: SlugVehicleParams;
      searchParams: Query;
    }) {
      const [{ slug, vehicleSlug }, query] = await Promise.all([params, searchParams]);
      const site = await findPublishedSiteBySlug(slug);
      if (!site) notFound();
      return renderSiteVehicle(site, vehicleSlug, query, locale);
    },
  };
}
