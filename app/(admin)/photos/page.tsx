import { requireCurrentWorkspace } from "@/lib/auth";
import { getI18n } from "@/lib/i18n-server";
import { prisma } from "@/lib/prisma";
import { formatDateTime } from "@/lib/utils";

function isVideo(contentType?: string | null, filename?: string | null) {
  const type = contentType?.toLowerCase() ?? "";
  const name = filename?.toLowerCase() ?? "";
  return type.startsWith("video/") || /\.(mp4|mov|m4v|webm|3gp|avi|qt)$/.test(name);
}

export default async function PhotosPage() {
  const workspace = await requireCurrentWorkspace();
  const [{ locale }, attachments] = await Promise.all([
    getI18n(),
    prisma.orderAttachment.findMany({
      where: {
        workspaceId: workspace.id,
        isArchived: false,
        kind: "photo",
        orderId: { not: null },
      },
      include: {
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
          description: "集中查看所有订单上传的车辆照片、交接视频和其他影像资料。",
          empty: "还没有上传照片或视频。请在日历订单详情里上传。",
        }
      : {
          kicker: "Attachment center",
          title: "Photos and videos",
          description: "Review vehicle handoff photos, videos, and media uploaded against orders.",
          empty: "No photos or videos yet. Upload from a calendar order detail.",
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
        <section className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
          {attachments.map((attachment) => {
            if (!attachment.order) return null;
            const url = `/api/orders/${attachment.orderId}/attachments/file?attachmentId=${attachment.id}`;
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
                    {attachment.order.vehicle.plateNumber} · {attachment.order.vehicle.nickname}
                  </p>
                  <p className="truncate text-[11px] text-[var(--ink-soft)]">
                    {attachment.order.renterName} · {formatDateTime(attachment.uploadedAt, locale)}
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
