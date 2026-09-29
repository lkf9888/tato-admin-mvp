import { DirectBookingSubpageFrame } from "@/components/direct-booking-subpage-frame";
import { TuroBookmarklet, TuroPhotoImport } from "@/components/turo-photo-import";
import { requireCurrentWorkspace } from "@/lib/auth";
import { getI18n } from "@/lib/i18n-server";
import { prisma } from "@/lib/prisma";
import { getRequestHost } from "@/lib/rental-site";

const PHOTO_ID = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * Where the "Import to TATO" bookmarklet lands: a Turo listing's photo
 * ids, to put on one of the workspace's cars. Opened with no ids, it is
 * the page that explains the bookmarklet and offers it for dragging.
 */
export default async function TuroPhotosPage({
  searchParams,
}: {
  searchParams: Promise<{ listing?: string; ids?: string }>;
}) {
  const workspace = await requireCurrentWorkspace();
  const [query, { locale, messages }, host] = await Promise.all([
    searchParams,
    getI18n(),
    getRequestHost(),
  ]);
  const copy = messages.directBookingTuroImport;
  const origin = `${host.includes("localhost") ? "http" : "https"}://${host}`;

  const listingId = /^\d{4,}$/.test(query.listing ?? "") ? query.listing! : null;
  const photoIds = (query.ids ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id, index, all) => PHOTO_ID.test(id) && all.indexOf(id) === index)
    .slice(0, 12);

  const vehicles = listingId
    ? await prisma.vehicle.findMany({
        where: { workspaceId: workspace.id, isArchived: false },
        orderBy: { plateNumber: "asc" },
        select: {
          id: true,
          plateNumber: true,
          brand: true,
          model: true,
          year: true,
          turoVehicleCode: true,
          _count: { select: { attachments: { where: { isArchived: false, kind: "photo" } } } },
        },
      })
    : [];
  const matched = vehicles.find((vehicle) => vehicle.turoVehicleCode === listingId) ?? null;

  return (
    <div className="space-y-3">
      <DirectBookingSubpageFrame workspaceId={workspace.id} locale={locale} active="vehicles" />
      {listingId && photoIds.length > 0 ? (
        <TuroPhotoImport
          locale={locale}
          listingId={listingId}
          photoIds={photoIds}
          matchedVehicleId={matched?.id ?? null}
          vehicles={vehicles.map((vehicle) => ({
            id: vehicle.id,
            label: `${vehicle.plateNumber} · ${vehicle.year} ${vehicle.brand} ${vehicle.model}`,
            photoCount: vehicle._count.attachments,
          }))}
        />
      ) : (
        <section className="rounded-lg border border-[color:var(--line)] bg-[rgba(255,255,255,0.88)] px-3 py-3">
          <h3 className="text-[1.05rem] font-semibold text-[color:var(--ink)]">{copy.title}</h3>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-[12px] leading-5 text-[color:var(--ink-mid)]">
            {copy.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </section>
      )}
      <TuroBookmarklet locale={locale} origin={origin} />
    </div>
  );
}
