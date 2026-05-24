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
  className,
}: {
  photos: VehicleCarouselPhoto[];
  fallbackLabel: string;
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
          "flex aspect-[16/10] min-h-[20rem] items-center justify-center rounded-lg border border-slate-200 bg-slate-100 text-center",
          className,
        )}
      >
        <div>
          <p className="text-[11px] uppercase tracking-[0.34em] text-slate-400">TATO</p>
          <p className="mt-3 text-2xl font-semibold text-slate-950">{fallbackLabel}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative aspect-[16/10] min-h-[20rem] overflow-hidden rounded-lg border border-slate-200 bg-slate-100",
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
            className="absolute left-3 top-1/2 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-md border border-white/70 bg-white/90 text-slate-950 shadow-sm backdrop-blur transition hover:bg-white"
            aria-label="Previous photo"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => setActiveIndex((current) => (current + 1) % safePhotos.length)}
            className="absolute right-3 top-1/2 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-md border border-white/70 bg-white/90 text-slate-950 shadow-sm backdrop-blur transition hover:bg-white"
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
                  "h-2.5 rounded-md border border-white/70 transition",
                  index === activeIndex ? "w-7 bg-white" : "w-2.5 bg-white/50 hover:bg-white/80",
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
