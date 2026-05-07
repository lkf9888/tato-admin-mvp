import { requireCurrentWorkspace } from "@/lib/auth";
import { getI18n } from "@/lib/i18n-server";
import { prisma } from "@/lib/prisma";
import { formatDateTime } from "@/lib/utils";

function formatSize(bytes: number | null) {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function DocumentsPage() {
  const workspace = await requireCurrentWorkspace();
  const [{ locale }, attachments] = await Promise.all([
    getI18n(),
    prisma.orderAttachment.findMany({
      where: {
        workspaceId: workspace.id,
        isArchived: false,
        kind: "document",
        OR: [{ orderId: { not: null } }, { vehicleId: { not: null } }],
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
          title: "合约文件",
          description: "集中查看订单和车辆档案上传的合同、驾驶证、保险或其他文件。",
          empty: "还没有上传合约文件。请在日历订单详情或车辆编辑里上传。",
          file: "文件",
          order: "关联对象",
          uploaded: "上传时间",
          open: "打开文件",
          vehicleFile: "车辆档案",
        }
      : {
          kicker: "Attachment center",
          title: "Contract files",
          description: "Review contracts, driver licenses, insurance files, and other order or vehicle documents.",
          empty: "No contract files yet. Upload from a calendar order detail or vehicle editor.",
          file: "File",
          order: "Related item",
          uploaded: "Uploaded",
          open: "Open file",
          vehicleFile: "Vehicle file",
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

      {attachments.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--line)] bg-white/80 p-6 text-[12px] text-[var(--ink-soft)]">
          {copy.empty}
        </div>
      ) : (
        <section className="overflow-hidden rounded-lg border border-[var(--line)] bg-white/90 shadow-sm">
          <div className="grid grid-cols-[1.35fr_1.2fr_0.8fr_0.55fr] gap-2 border-b border-[var(--line)] bg-slate-50 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-soft)]">
            <span>{copy.file}</span>
            <span>{copy.order}</span>
            <span>{copy.uploaded}</span>
            <span />
          </div>
          <div className="divide-y divide-[var(--line)]">
            {attachments.map((attachment) => {
              const orderVehicle = attachment.order?.vehicle;
              const vehicle = attachment.vehicle ?? orderVehicle;
              if (!vehicle) return null;
              const url = attachment.vehicleId
                ? `/api/vehicles/${attachment.vehicleId}/attachments/file?attachmentId=${attachment.id}`
                : `/api/orders/${attachment.orderId}/attachments/file?attachmentId=${attachment.id}`;
              return (
                <article
                  key={attachment.id}
                  className="grid grid-cols-[1.35fr_1.2fr_0.8fr_0.55fr] gap-2 px-3 py-2.5 text-[12px]"
                >
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-[var(--ink)]">
                      {attachment.filename ?? "attachment"}
                    </p>
                    <p className="mt-0.5 text-[10.5px] text-[var(--ink-soft)]">
                      {formatSize(attachment.size)}
                    </p>
                  </div>
                  <div className="min-w-0 text-[var(--ink-soft)]">
                    <p className="truncate font-semibold text-[var(--ink)]">
                      {vehicle.plateNumber} · {vehicle.nickname}
                    </p>
                    <p className="truncate">{attachment.order?.renterName ?? copy.vehicleFile}</p>
                  </div>
                  <p className="text-[var(--ink-soft)]">{formatDateTime(attachment.uploadedAt, locale)}</p>
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-right text-[11px] font-semibold text-[var(--ink)]"
                  >
                    {copy.open}
                  </a>
                </article>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
