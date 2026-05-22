import { requireCurrentWorkspace } from "@/lib/auth";
import { getI18n } from "@/lib/i18n-server";
import { prisma } from "@/lib/prisma";
import { formatDateTime } from "@/lib/utils";

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
  const workspace = await requireCurrentWorkspace();
  const params = await searchParams;
  const selectedVehicleIds = params.vehicle ? params.vehicle.split(",").filter(Boolean) : [];
  const q = params.q?.trim() ?? "";

  const [{ locale }, vehicles, attachments] = await Promise.all([
    getI18n(),
    prisma.vehicle.findMany({
      where: { workspaceId: workspace.id },
      orderBy: [{ plateNumber: "asc" }, { nickname: "asc" }],
      select: { id: true, plateNumber: true, nickname: true },
    }),
    prisma.orderAttachment.findMany({
      where: {
        workspaceId: workspace.id,
        isArchived: false,
        kind: "photo",
        OR: [{ orderId: { not: null } }, { vehicleId: { not: null } }],
        ...(selectedVehicleIds.length
          ? {
              OR: [
                { vehicleId: { in: selectedVehicleIds } },
                { order: { vehicleId: { in: selectedVehicleIds } } },
              ],
            }
          : {}),
        ...(q
          ? {
              AND: [
                {
                  OR: [
                    { filename: { contains: q } },
                    { order: { renterName: { contains: q } } },
                    { order: { renterPhone: { contains: q } } },
                    { order: { notes: { contains: q } } },
                    { order: { vehicle: { plateNumber: { contains: q } } } },
                    { order: { vehicle: { nickname: { contains: q } } } },
                    { vehicle: { plateNumber: { contains: q } } },
                    { vehicle: { nickname: { contains: q } } },
                  ],
                },
              ],
            }
          : {}),
      },
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
          kicker: "附件中心",
          title: "照片和视频",
          description: "集中查看订单和车辆档案上传的车辆照片、交接视频和其他影像资料。",
          empty: "还没有上传照片或视频。请在日历订单详情或车辆编辑里上传。",
          filterLabel: "车辆",
          allVehicles: "全部车辆",
          searchPlaceholder: "搜索文件名、车牌、车辆、租客、电话或备注",
          search: "搜索",
          apply: "筛选",
        }
      : {
          kicker: "Attachment center",
          title: "Photos and videos",
          description: "Review vehicle handoff photos, videos, and media uploaded against orders or vehicles.",
          empty: "No photos or videos yet. Upload from a calendar order detail or vehicle editor.",
          filterLabel: "Vehicle",
          allVehicles: "All vehicles",
          searchPlaceholder: "Search file, plate, vehicle, renter, phone, or notes",
          search: "Search",
          apply: "Filter",
        };

  return (
    <div className="space-y-3">
      <section className="rounded-lg border border-[var(--line)] bg-white/90 p-3 shadow-sm sm:p-4">
        <p className="text-[10px] uppercase tracking-[0.22em] text-[var(--ink-soft)]">
          {copy.kicker}
        </p>
        <h1 className="mt-1 font-serif text-[1.2rem] font-semibold text-[var(--ink)] sm:text-[1.45rem]">
          {copy.title}
        </h1>
        <p className="mt-1 max-w-3xl text-[12px] text-[var(--ink-soft)]">{copy.description}</p>
      </section>

      <form className="grid gap-2 rounded-lg border border-[var(--line)] bg-white p-3 text-sm sm:grid-cols-[12rem_minmax(0,1fr)_auto]">
        <label className="block">
          <span className="label">{copy.filterLabel}</span>
          <select name="vehicle" defaultValue={selectedVehicleIds[0] ?? ""} className="input">
            <option value="">{copy.allVehicles}</option>
            {vehicles.map((vehicle) => (
              <option key={vehicle.id} value={vehicle.id}>
                {vehicle.plateNumber} · {vehicle.nickname}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">{copy.search}</span>
          <input name="q" defaultValue={q} placeholder={copy.searchPlaceholder} className="input" />
        </label>
        <button className="btn-primary self-end">{copy.apply}</button>
      </form>

      {attachments.length === 0 ? (
        <div className="card border-dashed p-10 text-center text-sm text-neutral-500">
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
              <article key={attachment.id} className="overflow-hidden rounded-lg border border-[var(--line)] bg-white/90 shadow-sm">
                <a href={url} target="_blank" rel="noreferrer" className="block">
                  {isVideo(attachment.contentType, attachment.filename) ? (
                    <video src={url} className="h-36 w-full bg-slate-950 object-cover" controls />
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
