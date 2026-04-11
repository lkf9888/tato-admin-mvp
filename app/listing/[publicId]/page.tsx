import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { LanguageSwitcher } from "@/components/language-switcher";
import { getI18n } from "@/lib/i18n-server";
import { getLocalePreference } from "@/lib/i18n-server";
import {
  formatArea,
  formatBathrooms,
  formatBedrooms,
  getListingPhotoUrl,
  splitListingLines,
} from "@/lib/listings";
import { prisma } from "@/lib/prisma";
import { formatCurrency, formatDate } from "@/lib/utils";

function getPageCopy(locale: "en" | "zh") {
  if (locale === "zh") {
    return {
      brand: "Harborline Living",
      shareOnly: "私享房源页",
      invitation: "仅通过分享链接访问",
      monthlyRent: "月租",
      availableFrom: "可入住",
      area: "室内面积",
      quickLook: "房源速览",
      description: "房源介绍",
      highlights: "本房亮点",
      amenities: "配套设施",
      gallery: "图片集",
      address: "位置",
      contact: "联系租赁团队",
      email: "邮件联系",
      phone: "电话联系",
      pets: "宠物",
      parking: "停车",
      furnishing: "家具",
      readyNow: "即可入住",
      privateRelease: "这不是公开列表页。你看到的是租赁团队单独分享给你的房源详情。",
      footerTitle: "想预约看房？",
      footerCopy: "如果这套房适合你，可以直接联系房源团队确认可看房时间、申请要求和签约节奏。",
      summaryFallback: "这套房源目前还没有摘要说明。",
      addressFallback: "地址将在确认看房时提供。",
      noContact: "请联系分享该链接的租赁顾问获取下一步安排。",
      pageNotFound: "该房源暂时不可查看。",
    };
  }

  return {
    brand: "Harborline Living",
    shareOnly: "Private listing page",
    invitation: "Accessible only from a direct share link",
    monthlyRent: "Monthly rent",
    availableFrom: "Available",
    area: "Interior area",
    quickLook: "Quick look",
    description: "Description",
    highlights: "Highlights",
    amenities: "Amenities",
    gallery: "Gallery",
    address: "Location",
    contact: "Contact the leasing team",
    email: "Email team",
    phone: "Call team",
    pets: "Pets",
    parking: "Parking",
    furnishing: "Furnishing",
    readyNow: "Ready now",
    privateRelease: "This is not a public index page. You are seeing a home that was shared with you directly by the leasing team.",
    footerTitle: "Want to book a viewing?",
    footerCopy:
      "If this home feels like a fit, reach out to confirm showing times, application details, and next steps.",
    summaryFallback: "A summary for this home has not been added yet.",
    addressFallback: "Address details can be shared during showing coordination.",
    noContact: "Please contact the team member who shared this page for the next step.",
    pageNotFound: "This listing is not available right now.",
  };
}

async function getPublishedListing(publicId: string) {
  return prisma.rentalListing.findFirst({
    where: {
      publicId,
      status: "published",
    },
    include: {
      photos: {
        orderBy: { sortOrder: "asc" },
      },
    },
  });
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ publicId: string }>;
}): Promise<Metadata> {
  const { publicId } = await params;
  const listing = await getPublishedListing(publicId);

  if (!listing) {
    return {
      title: "Listing unavailable",
    };
  }

  return {
    title: `${listing.title} | Harborline Living`,
    description: listing.summary,
  };
}

export default async function ListingDetailPage({
  params,
}: {
  params: Promise<{ publicId: string }>;
}) {
  const [{ publicId }, { locale, messages }, localePreference] = await Promise.all([
    params,
    getI18n(),
    getLocalePreference(),
  ]);
  const listing = await getPublishedListing(publicId);

  if (!listing) {
    notFound();
  }

  const copy = getPageCopy(locale);
  const photos = listing.photos;
  const heroPhoto = photos[0];
  const galleryPhotos = photos.slice(1);
  const highlights = splitListingLines(listing.highlights);
  const amenities = splitListingLines(listing.amenities);
  const propertyFacts = [
    `${formatBedrooms(listing.bedrooms)} bed`,
    `${formatBathrooms(listing.bathrooms)} bath`,
    listing.areaSqft ? `${formatArea(listing.areaSqft, locale)} sqft` : null,
    listing.propertyType,
  ].filter(Boolean);

  return (
    <main className="min-h-screen bg-[#f3efe6] text-slate-950">
      <section className="relative overflow-hidden bg-[#0f1b19] text-white">
        {heroPhoto ? (
          <img
            src={getListingPhotoUrl(heroPhoto.id)}
            alt={listing.title}
            className="absolute inset-0 h-full w-full object-cover opacity-40"
          />
        ) : null}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(235,204,149,0.24),transparent_28%),linear-gradient(180deg,rgba(15,27,25,0.64),rgba(15,27,25,0.92))]" />

        <div className="relative mx-auto max-w-[1450px] px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-4 border-b border-white/10 pb-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-[0.34em] text-[#e6d0ab]">{copy.shareOnly}</p>
              <h1 className="mt-3 font-serif text-3xl text-white sm:text-4xl">{copy.brand}</h1>
            </div>

            <div className="flex flex-col gap-3 sm:items-end">
              <div className="max-w-md rounded-full border border-white/14 bg-white/6 px-4 py-2.5 text-sm text-white/72">
                {copy.invitation}
              </div>
              <LanguageSwitcher
                locale={locale}
                preference={localePreference}
                label={messages.shell.languageLabel}
                hint={messages.shell.languageHint}
                autoLabel={messages.shell.languageAutoLabel}
                className="w-full min-w-[18rem] border-white/12 bg-white/8 text-white backdrop-blur-md [&_p]:text-white/68"
              />
            </div>
          </div>

          <div className="grid gap-8 py-10 lg:grid-cols-[minmax(0,1.05fr)_360px] lg:items-end lg:py-16">
            <div className="max-w-4xl">
              <p className="text-[11px] uppercase tracking-[0.34em] text-[#e6d0ab]">
                {listing.neighborhood ? `${listing.neighborhood} · ${listing.city}` : `${listing.city}, ${listing.province}`}
              </p>
              <h2 className="mt-4 max-w-4xl font-serif text-5xl leading-[0.95] text-white sm:text-7xl">
                {listing.title}
              </h2>
              <p className="mt-6 max-w-2xl text-base leading-8 text-white/78">
                {listing.summary || copy.summaryFallback}
              </p>

              <div className="mt-8 flex flex-wrap gap-3">
                {propertyFacts.map((fact) => (
                  <span
                    key={fact}
                    className="rounded-full border border-white/12 bg-white/8 px-4 py-2 text-sm text-white/80 backdrop-blur-sm"
                  >
                    {fact}
                  </span>
                ))}
              </div>
            </div>

            <aside className="rounded-[2rem] border border-white/12 bg-white/8 p-5 text-white shadow-[0_30px_80px_-48px_rgba(0,0,0,0.72)] backdrop-blur-md">
              <p className="text-[11px] uppercase tracking-[0.28em] text-[#e6d0ab]">{copy.monthlyRent}</p>
              <p className="mt-3 font-serif text-5xl text-white">{formatCurrency(listing.monthlyRent, locale)}</p>
              <p className="mt-2 text-sm text-white/68">
                {listing.availableFrom ? `${copy.availableFrom}: ${formatDate(listing.availableFrom, locale)}` : copy.readyNow}
              </p>

              <div className="mt-6 space-y-3 border-t border-white/10 pt-5 text-sm text-white/78">
                <div className="flex items-center justify-between gap-4">
                  <span>{copy.quickLook}</span>
                  <span className="text-white">{listing.propertyType}</span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span>{copy.area}</span>
                  <span className="text-white">{listing.areaSqft ? `${formatArea(listing.areaSqft, locale)} sqft` : "—"}</span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span>{copy.availableFrom}</span>
                  <span className="text-white">
                    {listing.availableFrom ? formatDate(listing.availableFrom, locale) : copy.readyNow}
                  </span>
                </div>
              </div>

              <div className="mt-6 space-y-3">
                {listing.contactEmail ? (
                  <a
                    href={`mailto:${listing.contactEmail}`}
                    className="block rounded-full bg-[#e7cfaa] px-5 py-3 text-center text-sm font-medium text-[#14211d] transition hover:bg-white"
                  >
                    {copy.email}
                  </a>
                ) : null}
                {listing.contactPhone ? (
                  <a
                    href={`tel:${listing.contactPhone.replace(/\s+/g, "")}`}
                    className="block rounded-full border border-white/18 px-5 py-3 text-center text-sm font-medium text-white transition hover:border-white/40 hover:bg-white/8"
                  >
                    {copy.phone}
                  </a>
                ) : null}
                {!listing.contactEmail && !listing.contactPhone ? (
                  <p className="rounded-[1.4rem] border border-white/10 bg-white/6 px-4 py-4 text-sm leading-7 text-white/70">
                    {copy.noContact}
                  </p>
                ) : null}
              </div>
            </aside>
          </div>
        </div>
      </section>

      {galleryPhotos.length > 0 ? (
        <section className="mx-auto max-w-[1450px] px-4 py-6 sm:px-6 lg:px-8">
          <div className="grid gap-3 md:grid-cols-[1.2fr_0.8fr]">
            <div className="overflow-hidden rounded-[2rem]">
              <img
                src={getListingPhotoUrl(galleryPhotos[0].id)}
                alt={listing.title}
                className="h-[25rem] w-full object-cover transition duration-700 hover:scale-[1.03] sm:h-[32rem]"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-1">
              {galleryPhotos.slice(1, 3).map((photo) => (
                <div key={photo.id} className="overflow-hidden rounded-[2rem]">
                  <img
                    src={getListingPhotoUrl(photo.id)}
                    alt={listing.title}
                    className="h-48 w-full object-cover transition duration-700 hover:scale-[1.03] sm:h-[15.5rem]"
                  />
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      <section className="mx-auto grid max-w-[1450px] gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:px-8 lg:py-16">
        <div className="space-y-12">
          <section className="border-b border-black/8 pb-12">
            <p className="text-[11px] uppercase tracking-[0.3em] text-slate-500">{copy.description}</p>
            <div className="mt-5 grid gap-8 lg:grid-cols-[minmax(0,1fr)_260px]">
              <div>
                <p className="max-w-3xl text-lg leading-9 text-slate-700">{listing.description}</p>
              </div>
              <div className="rounded-[2rem] bg-white px-5 py-5 shadow-[0_24px_60px_-48px_rgba(15,23,42,0.45)]">
                <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">{copy.quickLook}</p>
                <div className="mt-4 space-y-4 text-sm text-slate-600">
                  <div className="flex items-center justify-between gap-4">
                    <span>{copy.monthlyRent}</span>
                    <span className="font-medium text-slate-950">{formatCurrency(listing.monthlyRent, locale)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span>{copy.availableFrom}</span>
                    <span className="font-medium text-slate-950">
                      {listing.availableFrom ? formatDate(listing.availableFrom, locale) : copy.readyNow}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span>{copy.area}</span>
                    <span className="font-medium text-slate-950">
                      {listing.areaSqft ? `${formatArea(listing.areaSqft, locale)} sqft` : "—"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {highlights.length > 0 ? (
            <section className="border-b border-black/8 pb-12">
              <p className="text-[11px] uppercase tracking-[0.3em] text-slate-500">{copy.highlights}</p>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {highlights.map((item) => (
                  <div
                    key={item}
                    className="rounded-[1.6rem] border border-[#e1e5dc] bg-white px-5 py-5 text-base leading-7 text-slate-700 shadow-[0_20px_50px_-42px_rgba(15,23,42,0.4)]"
                  >
                    {item}
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {amenities.length > 0 ? (
            <section className="border-b border-black/8 pb-12">
              <p className="text-[11px] uppercase tracking-[0.3em] text-slate-500">{copy.amenities}</p>
              <div className="mt-5 flex flex-wrap gap-3">
                {amenities.map((item) => (
                  <span
                    key={item}
                    className="rounded-full border border-[#d9ded4] bg-white px-4 py-2.5 text-sm text-slate-700"
                  >
                    {item}
                  </span>
                ))}
              </div>
            </section>
          ) : null}

          {photos.length > 0 ? (
            <section className="border-b border-black/8 pb-12">
              <p className="text-[11px] uppercase tracking-[0.3em] text-slate-500">{copy.gallery}</p>
              <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {photos.map((photo, index) => (
                  <div
                    key={photo.id}
                    className={`overflow-hidden rounded-[1.8rem] ${index % 3 === 0 ? "sm:col-span-2 xl:col-span-2" : ""}`}
                  >
                    <img
                      src={getListingPhotoUrl(photo.id)}
                      alt={listing.title}
                      className="h-[18rem] w-full object-cover transition duration-700 hover:scale-[1.03] sm:h-[22rem]"
                    />
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>

        <aside className="space-y-5 lg:sticky lg:top-6 lg:self-start">
          <div className="rounded-[2rem] bg-[#182823] p-5 text-white shadow-[0_26px_70px_-46px_rgba(15,23,42,0.7)]">
            <p className="text-[11px] uppercase tracking-[0.28em] text-[#e6d0ab]">{copy.privateRelease}</p>
            <p className="mt-4 text-sm leading-7 text-white/74">
              {listing.summary || copy.summaryFallback}
            </p>
          </div>

          <div className="rounded-[2rem] bg-white p-5 shadow-[0_26px_70px_-52px_rgba(15,23,42,0.44)]">
            <p className="text-[11px] uppercase tracking-[0.28em] text-slate-500">{copy.address}</p>
            <p className="mt-4 text-base leading-8 text-slate-700">
              {listing.addressLine ? `${listing.addressLine}, ${listing.city}, ${listing.province}` : copy.addressFallback}
            </p>

            <div className="mt-6 space-y-4 border-t border-black/6 pt-5 text-sm text-slate-600">
              <div className="flex items-center justify-between gap-4">
                <span>{copy.pets}</span>
                <span className="font-medium text-slate-950">{listing.petPolicy ?? "—"}</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span>{copy.parking}</span>
                <span className="font-medium text-slate-950">{listing.parkingInfo ?? "—"}</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span>{copy.furnishing}</span>
                <span className="font-medium text-slate-950">{listing.furnishedInfo ?? "—"}</span>
              </div>
            </div>
          </div>

          <div className="rounded-[2rem] border border-[#d7ddd4] bg-[#f9faf6] p-5">
            <p className="text-[11px] uppercase tracking-[0.28em] text-slate-500">{copy.contact}</p>
            <p className="mt-4 text-base text-slate-950">{listing.contactName ?? copy.contact}</p>
            <div className="mt-5 space-y-3">
              {listing.contactEmail ? (
                <a
                  href={`mailto:${listing.contactEmail}`}
                  className="block rounded-full bg-[#182823] px-5 py-3 text-center text-sm font-medium text-white transition hover:bg-[#101925]"
                >
                  {copy.email}
                </a>
              ) : null}
              {listing.contactPhone ? (
                <a
                  href={`tel:${listing.contactPhone.replace(/\s+/g, "")}`}
                  className="block rounded-full border border-[#d0d7cc] px-5 py-3 text-center text-sm font-medium text-slate-700 transition hover:border-slate-900 hover:text-slate-950"
                >
                  {copy.phone}
                </a>
              ) : null}
              {!listing.contactEmail && !listing.contactPhone ? (
                <p className="rounded-[1.5rem] bg-white px-4 py-4 text-sm leading-7 text-slate-600">
                  {copy.noContact}
                </p>
              ) : null}
            </div>
          </div>
        </aside>
      </section>

      <section className="border-t border-black/8 bg-white/60">
        <div className="mx-auto max-w-[1450px] px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-[0.3em] text-slate-500">{copy.contact}</p>
              <h3 className="mt-3 font-serif text-4xl text-slate-950">{copy.footerTitle}</h3>
              <p className="mt-4 max-w-2xl text-base leading-8 text-slate-700">{copy.footerCopy}</p>
            </div>

            <div className="flex flex-wrap gap-3">
              {listing.contactEmail ? (
                <a
                  href={`mailto:${listing.contactEmail}`}
                  className="rounded-full bg-[#182823] px-5 py-3 text-sm font-medium text-white transition hover:bg-[#101925]"
                >
                  {copy.email}
                </a>
              ) : null}
              {listing.contactPhone ? (
                <a
                  href={`tel:${listing.contactPhone.replace(/\s+/g, "")}`}
                  className="rounded-full border border-[#d0d7cc] px-5 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-900 hover:text-slate-950"
                >
                  {copy.phone}
                </a>
              ) : null}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
