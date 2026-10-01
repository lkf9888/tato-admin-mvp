"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { getMessages, type Locale } from "@/lib/i18n";
import { formatCurrency } from "@/lib/utils";

type Photo = { id: string; filename: string; capturedAt: string | null; hasLocation: boolean };
type Side = { odometerKm: number | null; fuelLevel: string | null; note: string | null; photos: Photo[] };
type Stage = "pickup" | "return";
type View = Record<Stage, { renter: Side; operator: Side }> & {
  mileage: {
    driven: number;
    allowance: number | null;
    excess: number;
    excessRate: number;
    excessAmount: number;
  } | null;
};

const FUEL_LEVELS = ["Full", "3/4", "1/2", "1/4", "Empty"];

/**
 * The operator's side of a direct booking's handovers, on the order:
 * photos and odometer at pickup and at return, next to the renter's own
 * photos. Self-contained like the extra-days panel; renders nothing for
 * an order that is not a direct booking.
 */
export function DirectBookingHandoverPanel({ locale, orderId }: { locale: Locale; orderId: string }) {
  const copy = getMessages(locale).directBookingHandover;
  const [view, setView] = useState<View | null>(null);
  const [hidden, setHidden] = useState(false);
  const base = `/api/direct-booking/orders/${orderId}/handover`;

  const load = useCallback(async () => {
    const response = await fetch(base, { cache: "no-store" });
    if (!response.ok) {
      setHidden(true);
      return;
    }
    setView((await response.json()) as View);
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  if (hidden || !view) return null;

  return (
    <section className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-3 sm:px-4">
      <p className="t-eyebrow text-[var(--ink-soft)]">{copy.title}</p>
      <div className="mt-2 grid gap-3 lg:grid-cols-2">
        {(["pickup", "return"] as const).map((stage) => (
          <StageCard
            key={stage}
            stage={stage}
            data={view[stage]}
            base={base}
            copy={copy}
            onChanged={load}
          />
        ))}
      </div>
      {view.mileage ? (
        <p className="mt-3 rounded-md bg-[var(--surface-muted)] px-3 py-2 text-[12px] text-[var(--ink-mid)]">
          {copy.mileage(
            view.mileage.driven,
            view.mileage.allowance,
            view.mileage.excess,
            formatCurrency(view.mileage.excessAmount, locale),
          )}
        </p>
      ) : null}
    </section>
  );
}

function StageCard({
  stage,
  data,
  base,
  copy,
  onChanged,
}: {
  stage: Stage;
  data: { renter: Side; operator: Side };
  base: string;
  copy: ReturnType<typeof getMessages>["directBookingHandover"];
  onChanged: () => Promise<void>;
}) {
  const [odometer, setOdometer] = useState(data.operator.odometerKm?.toString() ?? "");
  const [fuel, setFuel] = useState(data.operator.fuelLevel ?? "");
  const [note, setNote] = useState(data.operator.note ?? "");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function saveReadings() {
    setBusy(copy.saving);
    setMessage(null);
    const response = await fetch(base, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        stage,
        odometerKm: odometer.trim() ? Math.round(Number(odometer)) : null,
        fuelLevel: fuel || null,
        note: note.trim() || null,
      }),
    });
    setBusy("");
    setMessage(response.ok ? { ok: true, text: copy.saved } : { ok: false, text: copy.saveFailed });
    if (response.ok) await onChanged();
  }

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    const list = Array.from(files);
    let failed = 0;
    for (const [index, file] of list.entries()) {
      setBusy(copy.uploading(index + 1, list.length));
      const body = new FormData();
      body.set("stage", stage);
      body.set("file", file);
      const response = await fetch(base, { method: "POST", body }).catch(() => null);
      if (!response?.ok) failed += 1;
    }
    setBusy("");
    setMessage(failed ? { ok: false, text: copy.uploadFailed(failed) } : null);
    if (fileInput.current) fileInput.current.value = "";
    await onChanged();
  }

  const thumbs = (photos: Photo[], empty: string) =>
    photos.length === 0 ? (
      <p className="text-[11px] text-[var(--ink-soft)]">{empty}</p>
    ) : (
      <div className="grid grid-cols-5 gap-1">
        {photos.map((photo) => (
          <a key={photo.id} href={`${base}/photos/${photo.id}`} target="_blank" rel="noreferrer" title={photo.filename}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`${base}/photos/${photo.id}`}
              alt=""
              loading="lazy"
              className="aspect-square w-full rounded object-cover"
            />
          </a>
        ))}
      </div>
    );

  const field = "h-8 w-full rounded-md border border-[var(--line)] bg-white px-2 text-[12px]";

  return (
    <div className="rounded-md border border-[var(--line)] bg-white p-3">
      <p className="text-[13px] font-semibold text-[var(--ink)]">
        {stage === "pickup" ? copy.pickupTitle : copy.returnTitle}
      </p>

      <p className="mt-2 text-[11px] font-medium text-[var(--ink-mid)]">
        {copy.renterPhotos(data.renter.photos.length)}
      </p>
      <div className="mt-1">{thumbs(data.renter.photos, copy.noRenterPhotos)}</div>

      <p className="mt-3 text-[11px] font-medium text-[var(--ink-mid)]">
        {copy.yourPhotos(data.operator.photos.length)}
      </p>
      <div className="mt-1">{thumbs(data.operator.photos, copy.noYourPhotos)}</div>
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(event) => void upload(event.target.files)}
      />
      <button
        type="button"
        disabled={busy !== ""}
        onClick={() => fileInput.current?.click()}
        className="mt-2 rounded-md border border-[var(--line)] px-3 py-1.5 text-[12px] font-medium text-[var(--ink)] hover:bg-[var(--surface-muted)] disabled:opacity-60"
      >
        {copy.upload}
      </button>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-[11px] text-[var(--ink-mid)]">{copy.odometer}</span>
          <input
            type="number"
            min="0"
            inputMode="numeric"
            value={odometer}
            onChange={(event) => setOdometer(event.target.value)}
            className={`${field} tabular-nums`}
          />
        </label>
        <label className="block">
          <span className="text-[11px] text-[var(--ink-mid)]">{copy.fuel}</span>
          <select value={fuel} onChange={(event) => setFuel(event.target.value)} className={field}>
            <option value="">—</option>
            {FUEL_LEVELS.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        </label>
      </div>
      <input
        value={note}
        onChange={(event) => setNote(event.target.value)}
        maxLength={1000}
        placeholder={copy.notePlaceholder}
        className={`${field} mt-2`}
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy !== ""}
          onClick={() => void saveReadings()}
          className="rounded-md bg-[var(--ink)] px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-60"
          style={{ backgroundColor: "var(--ink)", color: "#ffffff" }}
        >
          {busy || copy.save}
        </button>
        {message ? (
          <span className={`text-[11px] ${message.ok ? "text-[color:var(--ok-fg)]" : "text-[color:var(--bad-fg)]"}`}>
            {message.text}
          </span>
        ) : null}
      </div>
    </div>
  );
}
