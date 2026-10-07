"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { BusyLabel } from "@/components/booking-spinner";
import { getMessages, type Locale } from "@/lib/i18n";

type Photo = { id: string; filename: string; capturedAt: string | null; uploadedAt: string };
type Side = { photos: Photo[] };
type Stage = "pickup" | "return";

/**
 * The renter's check-in and check-out, on their booking page: photos of
 * the car when they collect it and when they bring it back, like Turo's.
 * Uploaded one at a time, as taken, so a weak signal in a car park
 * loses one photo rather than the whole set.
 */
export function BookingHandoverRenter({
  locale,
  token,
  returnOpen,
}: {
  locale: Locale;
  token: string;
  /** Whether the trip has started, so return photos make sense. */
  returnOpen: boolean;
}) {
  const copy = getMessages(locale).bookingPage;
  const [sides, setSides] = useState<Record<Stage, Side> | null>(null);
  const [busy, setBusy] = useState<Stage | null>(null);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const inputs = useRef<Record<Stage, HTMLInputElement | null>>({ pickup: null, return: null });

  const load = useCallback(async () => {
    const response = await fetch(`/api/booking/${token}/handover`, { cache: "no-store" });
    if (response.ok) setSides((await response.json()) as Record<Stage, Side>);
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function upload(stage: Stage, files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(stage);
    setError("");
    const list = Array.from(files);
    let failed = 0;
    for (const [index, file] of list.entries()) {
      setProgress(copy.handoverUploading(index + 1, list.length));
      const body = new FormData();
      body.set("stage", stage);
      body.set("file", file);
      const response = await fetch(`/api/booking/${token}/handover`, { method: "POST", body }).catch(
        () => null,
      );
      if (!response?.ok) failed += 1;
    }
    setBusy(null);
    setProgress("");
    if (failed > 0) setError(copy.handoverFailed(failed));
    if (inputs.current[stage]) inputs.current[stage]!.value = "";
    await load();
  }

  const stageCard = (stage: Stage) => {
    const photos = sides?.[stage].photos ?? [];
    const open = stage === "pickup" || returnOpen;
    return (
      <div key={stage} className="rounded-lg border border-[var(--line)] bg-white p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-[var(--ink)]">
            {stage === "pickup" ? copy.handoverPickupTitle : copy.handoverReturnTitle}
          </h3>
          <span className="text-[12px] text-[var(--ink-soft)]">{copy.handoverCount(photos.length)}</span>
        </div>
        <p className="mt-1 text-[12px] leading-5 text-[var(--ink-soft)]">
          {open ? copy.handoverShots : copy.handoverReturnLater}
        </p>
        {photos.length > 0 ? (
          <div className="mt-3 grid grid-cols-4 gap-1.5">
            {photos.map((photo) => (
              <a
                key={photo.id}
                href={`/api/booking/${token}/handover/photos/${photo.id}`}
                target="_blank"
                rel="noreferrer"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/booking/${token}/handover/photos/${photo.id}`}
                  alt=""
                  loading="lazy"
                  className="aspect-square w-full rounded object-cover"
                />
              </a>
            ))}
          </div>
        ) : null}
        {open ? (
          <>
            <input
              ref={(element) => {
                inputs.current[stage] = element;
              }}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(event) => void upload(stage, event.target.files)}
            />
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => inputs.current[stage]?.click()}
              className="mt-3 h-11 w-full rounded-[var(--control-radius)] bg-[var(--brand)] px-4 text-sm font-semibold text-white disabled:opacity-60"
            >
              <BusyLabel
                busy={busy === stage}
                idle={photos.length ? copy.handoverAddMore : copy.handoverAction}
                working={progress}
              />
            </button>
          </>
        ) : null}
      </div>
    );
  };

  return (
    <section className="mt-6 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-5">
      <h2 className="text-lg font-semibold text-[var(--ink)]">{copy.handoverTitle}</h2>
      <p className="mt-1 text-[13px] leading-6 text-[var(--ink-soft)]">{copy.handoverCopy}</p>
      {error ? (
        <p className="mt-3 rounded-md bg-[var(--bad-bg)] px-3 py-2 text-[13px] text-[color:var(--bad-fg)]">{error}</p>
      ) : null}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {stageCard("pickup")}
        {stageCard("return")}
      </div>
    </section>
  );
}
