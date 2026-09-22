"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { cn } from "@/lib/utils";

type VehicleCarouselPhoto = {
  id: string;
  src: string;
  alt: string;
};

export function VehiclePhotoCarousel({
  photos,
  fallbackLabel,
  /** The kicker over the no-photo placeholder. Defaults to TATO for
   *  the platform's own pages; a rental site passes its own name,
   *  because somebody else's brand on a customer's site is the one
   *  thing a white-labelled page must never show. */
  brandLabel = "TATO",
  className,
}: {
  photos: VehicleCarouselPhoto[];
  fallbackLabel: string;
  brandLabel?: string;
  className?: string;
}) {
  const safePhotos = useMemo(() => photos.filter((photo) => photo.src), [photos]);
  const [activeIndex, setActiveIndex] = useState(0);
  const activePhoto = safePhotos[activeIndex];

  useEffect(() => {
    if (safePhotos.length < 2) return;

    const timer = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % safePhotos.length);
    }, 4200);

    return () => window.clearInterval(timer);
  }, [safePhotos.length]);

  useEffect(() => {
    if (activeIndex < safePhotos.length) return;
    setActiveIndex(0);
  }, [activeIndex, safePhotos.length]);

  if (!activePhoto) {
    return (
      <div
        className={cn(
          // `aspect-[16/10]` with an unconditional `min-h-[20rem]` makes
          // the browser derive the WIDTH from the height: 320px tall at
          // 16/10 is 512px wide, which is 137px past a 375px phone and
          // put a horizontal scrollbar on every photo-less car page.
          // `w-full` bounds the width; the floor only applies once
          // there is room for it.
          "flex w-full aspect-[16/10] items-center justify-center rounded-lg border border-[var(--line)] bg-[var(--surface-muted)] px-4 text-center sm:min-h-[20rem]",
          className,
        )}
      >
        <div className="min-w-0 break-words">
          <p className="text-[11px] uppercase tracking-[0.34em] text-[var(--ink-soft)]">
            {brandLabel}
          </p>
          <p className="mt-3 text-2xl font-semibold text-[var(--ink)]">{fallbackLabel}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative w-full aspect-[16/10] overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--surface-muted)] sm:min-h-[20rem]",
        className,
      )}
    >
      <img
        key={activePhoto.id}
        src={activePhoto.src}
        alt={activePhoto.alt}
        className="h-full w-full object-cover"
      />

      {safePhotos.length > 1 ? (
        <>
          <button
            type="button"
            onClick={() =>
              setActiveIndex((current) => (current - 1 + safePhotos.length) % safePhotos.length)
            }
            className="absolute left-3 top-1/2 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-md border border-[var(--line)] bg-[var(--surface)] text-[var(--ink)] backdrop-blur transition hover:bg-white"
            aria-label="Previous photo"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => setActiveIndex((current) => (current + 1) % safePhotos.length)}
            className="absolute right-3 top-1/2 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-md border border-[var(--line)] bg-[var(--surface)] text-[var(--ink)] backdrop-blur transition hover:bg-white"
            aria-label="Next photo"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
          <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-1.5">
            {safePhotos.map((photo, index) => (
              <button
                key={photo.id}
                type="button"
                onClick={() => setActiveIndex(index)}
                className={cn(
                  "h-2.5 rounded-md border border-[var(--line)] transition",
                  index === activeIndex ? "w-7 bg-white" : "w-2.5 bg-white/50 hover:bg-[var(--surface)]",
                )}
                aria-label={`Show photo ${index + 1}`}
              />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
