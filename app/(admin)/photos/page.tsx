import { AttachmentsZipButton } from "@/components/attachments-zip-button";
import { SearchableSelect } from "@/components/searchable-select";
import { requireAccessContext } from "@/lib/auth";
import { getI18n } from "@/lib/i18n-server";
import { attachmentListWhere } from "@/lib/attachment-list";
import { prisma } from "@/lib/prisma";
import { formatDateTime } from "@/lib/utils";
import { SEARCH_FIELD_PROPS } from "@/lib/search-field-props";

function isVideo(contentType?: string | null, filename?: string | null) {
  const type = contentType?.toLowerCase() ?? "";
  const name = filename?.toLowerCase() ?? "";
  return type.startsWith("video/") || /\.(mp4|mov|m4v|webm|3gp|avi|qt)$/.test(name);
}

type SearchParams = Promise<{ vehicle?: string; q?: string }>;

export default async function PhotosPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { workspace, vehicleIds: scope } = await requireAccessContext();
  const params = await searchParams;
  const selectedVehicleIds = params.vehicle ? params.vehicle.split(",").filter(Boolean) : [];
  const q = params.q?.trim() ?? "";

  const [{ locale }, vehicles, attachments] = await Promise.all([
    getI18n(),
    prisma.vehicle.findMany({
      where: { workspaceId: workspace.id, ...(scope ? { id: { in: scope } } : {}) },
      orderBy: [{ plateNumber: "asc" }, { nickname: "asc" }],
      select: { id: true, plateNumber: true, nickname: true },
    }),
    prisma.orderAttachment.findMany({
      where: attachmentListWhere(workspace.id, { kind: "photo", vehicleIds: selectedVehicleIds, q, scope }),
      include: {
        vehicle: { include: { owner: true } },
        order: {
          include: {
            vehicle: { include: { owner: true } },
          },
        },
      },
      orderBy: { uploadedAt: "desc" },
      take: 240,
    }),
  ]);

  const copy =
    locale === "zh"
      ? {
          title: "照片和视频",
          empty: "还没有上传照片或视频。请在日历订单详情或车辆编辑里上传。",
          filterLabel: "车辆",
          allVehicles: "全部车辆",
          searchPlaceholder: "搜索文件名、车牌、车辆、租客、电话或备注",
          search: "搜索",
          apply: "筛选",
        }
      : {
          title: "Photos and videos",
          empty: "No photos or videos yet. Upload from a calendar order detail or vehicle editor.",
          filterLabel: "Vehicle",
          allVehicles: "All vehicles",
          searchPlaceholder: "Search file, plate, vehicle, renter, phone, or notes",
          search: "Search",
          apply: "Filter",
        };
  const vehicleOptions = [
    { value: "", label: copy.allVehicles },
    ...vehicles.map((vehicle) => ({
      value: vehicle.id,
      label: `${vehicle.plateNumber} · ${vehicle.nickname}`,
      searchText: `${vehicle.plateNumber} ${vehicle.nickname}`,
    })),
  ];

  return (
    <div className="space-y-3">
      <h1 className="sr-only">{copy.title}</h1>

      <form className="grid gap-2 rounded-lg border border-[var(--line)] bg-white p-3 text-sm sm:grid-cols-[12rem_minmax(0,1fr)_auto]">
        <label className="block">
          <span className="label">{copy.filterLabel}</span>
          <SearchableSelect
            name="vehicle"
            defaultValue={selectedVehicleIds[0] ?? ""}
            options={vehicleOptions}
            placeholder={copy.allVehicles}
            searchPlaceholder={copy.filterLabel}
            className="input"
          />
        </label>
        <label className="block">
          <span className="label">{copy.search}</span>
          <input type="search" name="q" {...SEARCH_FIELD_PROPS} defaultValue={q} placeholder={copy.searchPlaceholder} className="input" />
        </label>
        <button className="btn-primary self-end">{copy.apply}</button>
      </form>
      <AttachmentsZipButton
        kind="photo"
        vehicle={params.vehicle ?? ""}
        q={q}
        locale={locale}
        filename={`tato-photos-${new Date().toISOString().slice(0, 10)}.zip`}
      />

      {attachments.length === 0 ? (
        <div className="card border-dashed p-10 text-center text-sm text-[var(--ink-soft)]">
          {copy.empty}
        </div>
      ) : (
        <section className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
          {attachments.map((attachment) => {
            const orderVehicle = attachment.order?.vehicle;
            const vehicle = attachment.vehicle ?? orderVehicle;
            if (!vehicle) return null;
            const url = attachment.vehicleId
              ? `/api/vehicles/${attachment.vehicleId}/attachments/file?attachmentId=${attachment.id}`
              : `/api/orders/${attachment.orderId}/attachments/file?attachmentId=${attachment.id}`;
            return (
              <article key={attachment.id} className="overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--surface)]">
                <a href={url} target="_blank" rel="noreferrer" className="block">
                  {isVideo(attachment.contentType, attachment.filename) ? (
                    <video src={url} className="h-36 w-full bg-[var(--ink)] object-cover" controls />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={url}
                      alt={attachment.filename ?? "attachment"}
                      className="h-36 w-full object-cover"
                    />
                  )}
                </a>
                <div className="space-y-1 px-3 py-2">
                  <p className="truncate text-[12px] font-semibold text-[var(--ink)]">
                    {vehicle.plateNumber} · {vehicle.nickname}
                  </p>
                  <p className="truncate text-[11px] text-[var(--ink-soft)]">
                    {attachment.order?.renterName ?? (locale === "zh" ? "车辆档案" : "Vehicle file")} · {formatDateTime(attachment.uploadedAt, locale)}
                  </p>
                </div>
              </article>
            );
          })}
        </section>
      )}
    </div>
  );
}
