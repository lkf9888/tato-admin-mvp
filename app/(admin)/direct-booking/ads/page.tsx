import { DirectBookingSubpageFrame } from "@/components/direct-booking-subpage-frame";
import { SiteAdCopyPanel } from "@/components/site-ad-copy-panel";
import { requireCurrentWorkspace } from "@/lib/auth";
import { getI18n } from "@/lib/i18n-server";
import { prisma } from "@/lib/prisma";
import { AD_PLATFORMS, buildAdDraft } from "@/lib/site-ad-copy";
import { loadAdFacts } from "@/lib/site-ad-copy-server";

type SearchParams = Promise<{ vehicle?: string }>;

/** Ready-to-paste classified ads for one car, one per platform. */
export default async function AdsPage({ searchParams }: { searchParams: SearchParams }) {
  const workspace = await requireCurrentWorkspace();
  const [{ locale, messages }, query, vehicles] = await Promise.all([
    getI18n(),
    searchParams,
    prisma.vehicle.findMany({
      where: { workspaceId: workspace.id, isArchived: false },
      select: { id: true, plateNumber: true, brand: true, model: true, year: true, directBookingEnabled: true },
      // Cars on the site first: those are the ones an ad can send people to.
      orderBy: [{ directBookingEnabled: "desc" }, { brand: "asc" }, { model: "asc" }],
    }),
  ]);
  const copy = messages.directBookingAds;
  const selected = vehicles.find((vehicle) => vehicle.id === query.vehicle) ?? vehicles[0] ?? null;
  const facts = selected ? await loadAdFacts(workspace.id, selected.id) : null;
  const drafts = facts ? AD_PLATFORMS.map((platform) => buildAdDraft(platform, facts)) : [];

  return (
    <div className="space-y-3">
      <DirectBookingSubpageFrame workspaceId={workspace.id} locale={locale} active="ads" />
      <section className="rounded-lg border border-[color:var(--line)] bg-[rgba(255,255,255,0.88)] px-3 py-3 sm:px-4">
        <h3 className="text-[1.05rem] font-semibold text-[color:var(--ink)]">{copy.title}</h3>
        <p className="mt-1 max-w-3xl text-[12px] leading-5 text-[color:var(--ink-soft)]">{copy.intro}</p>
        <form action="/direct-booking/ads" className="mt-3 flex flex-wrap items-center gap-2">
          <label className="text-[12px] text-[color:var(--ink-soft)]" htmlFor="ad-vehicle">
            {copy.carLabel}
          </label>
          <select
            id="ad-vehicle"
            name="vehicle"
            defaultValue={selected?.id}
            className="h-8 min-w-0 max-w-full rounded-md border border-[color:var(--line)] bg-white px-2 text-[12px]"
          >
            {vehicles.map((vehicle) => (
              <option key={vehicle.id} value={vehicle.id}>
                {vehicle.plateNumber} · {vehicle.year} {vehicle.brand} {vehicle.model}
                {vehicle.directBookingEnabled ? "" : ` (${copy.notListed})`}
              </option>
            ))}
          </select>
          <button type="submit" className="h-8 rounded-md border border-[color:var(--line)] bg-white px-3 text-[12px] font-medium">
            OK
          </button>
        </form>
      </section>
      {selected ? <SiteAdCopyPanel key={selected.id} locale={locale} vehicleId={selected.id} drafts={drafts} /> : null}
    </div>
  );
}
