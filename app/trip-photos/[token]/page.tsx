import { notFound } from "next/navigation";

import { getI18n } from "@/lib/i18n-server";
import { findSharedTripPhotos } from "@/lib/order-photo-share";
import { formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Trip photos",
  robots: { index: false, follow: false },
};

/**
 * Every photo of one trip, for whoever holds the link: an adjuster, the
 * renter, the car's owner. Read-only, no account, nothing about the
 * renter or the money -- the car, the dates and the pictures.
 */
export default async function TripPhotosPage({ params }: { params: Promise<{ token: string }> }) {
  const [{ token }, { locale }] = await Promise.all([params, getI18n()]);
  const shared = await findSharedTripPhotos(token);
  if (!shared) notFound();
  const { order } = shared;
  const zh = locale !== "en";
  const vehicle = `${order.vehicle.plateNumber} · ${order.vehicle.brand} ${order.vehicle.model} ${order.vehicle.year}`;

  return (
    <main className="min-h-screen bg-[var(--surface-muted)] px-3 py-6 text-[var(--ink)] sm:px-6">
      <div className="mx-auto max-w-5xl space-y-4">
        <header>
          <p className="text-xs text-[var(--ink-soft)]">{order.workspace?.name || "TATO"}</p>
          <h1 className="mt-1 text-2xl font-semibold">{zh ? "行程照片" : "Trip photos"}</h1>
          <p className="mt-1 text-sm text-[var(--ink-mid)]">{vehicle}</p>
          <p className="text-sm text-[var(--ink-soft)]">
            {formatDateTime(order.pickupDatetime, locale)} → {formatDateTime(order.returnDatetime, locale)}
          </p>
        </header>

        {order.attachments.length === 0 ? (
          <p className="rounded-md bg-white px-4 py-6 text-sm text-[var(--ink-soft)]">
            {zh ? "这个行程还没有照片。" : "No photos on this trip yet."}
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {order.attachments.map((photo) => {
              const src = `/api/trip-photos/${token}/${photo.id}`;
              const isVideo = photo.contentType?.startsWith("video/");
              return (
                <li key={photo.id} className="overflow-hidden rounded-md border border-[var(--line)] bg-white">
                  {isVideo ? (
                    <video src={src} controls preload="metadata" className="aspect-square w-full bg-black object-contain" />
                  ) : (
                    <a href={src} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={src} alt={photo.filename ?? ""} loading="lazy" className="aspect-square w-full object-cover" />
                    </a>
                  )}
                  <p className="truncate px-2 py-1 text-[11px] text-[var(--ink-soft)]">
                    {formatDateTime(photo.uploadedAt, locale)}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-[11px] text-[var(--ink-soft)]">
          {zh ? "只读页面。" : "Read-only page."} {zh ? `共 ${order.attachments.length} 个文件。` : `${order.attachments.length} file(s).`}
        </p>
      </div>
    </main>
  );
}
