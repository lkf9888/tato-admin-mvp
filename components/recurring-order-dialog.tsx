"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { SearchableSelect } from "@/components/searchable-select";
import { type Locale } from "@/lib/i18n";
import { cn, formatDateTime, todayDateInputValue } from "@/lib/utils";

/**
 * A monthly renter, booked in one go.
 *
 * The preview is the feature, not decoration. This is the one button
 * in the app that creates twelve orders, and a monthly cycle has
 * enough edge in it -- a rental that starts on the 31st, a February --
 * that "trust me" is not good enough. The server works out the dates
 * and reports the collisions; nothing is written until the operator
 * has seen them.
 */

type CyclePreview = {
  cycle: number;
  pickupDatetime: string;
  returnDatetime: string;
  conflicts: Array<{ id: string; renterName: string }>;
};

export function RecurringOrderDialog({
  locale,
  labels,
  vehicleOptions,
  defaultVehicleId,
  onClose,
}: {
  locale: Locale;
  labels: {
    title: string;
    subtitle: string;
    vehicle: string;
    renter: string;
    phone: string;
    startDate: string;
    startTime: string;
    cycles: string;
    price: string;
    preview: (count: number) => string;
    conflict: string;
    create: string;
    creating: string;
    created: (count: number) => string;
    failed: string;
    cancel: string;
    needsRenter: string;
  };
  vehicleOptions: Array<{ id: string; label: string; plateNumber?: string | null }>;
  defaultVehicleId?: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [vehicleId, setVehicleId] = useState(defaultVehicleId ?? vehicleOptions[0]?.id ?? "");
  const [renterName, setRenterName] = useState("");
  const [renterPhone, setRenterPhone] = useState("");
  const [startDate, setStartDate] = useState(() => todayDateInputValue());
  const [startTime, setStartTime] = useState("10:00");
  const [cycles, setCycles] = useState(3);
  const [totalPrice, setTotalPrice] = useState("");
  const [preview, setPreview] = useState<CyclePreview[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The preview follows the inputs, so the dates on screen are always
  // the dates that would be written.
  useEffect(() => {
    if (!vehicleId || !startDate) return;
    let cancelled = false;
    const handle = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/orders/recurring", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            vehicleId,
            // The preview does not write, so a name is not needed yet
            // -- asking for one before showing the dates would put the
            // work in the wrong order.
            renterName: renterName.trim() || "preview",
            startDate,
            startTime,
            cycles,
            preview: true,
          }),
        });
        if (!response.ok) throw new Error(String(response.status));
        const data = (await response.json()) as { cycles?: CyclePreview[] };
        if (!cancelled) setPreview(data.cycles ?? []);
      } catch {
        if (!cancelled) setPreview([]);
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [vehicleId, startDate, startTime, cycles, renterName]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function create() {
    if (!renterName.trim()) {
      setError(labels.needsRenter);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/orders/recurring", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vehicleId,
          renterName: renterName.trim(),
          renterPhone: renterPhone.trim(),
          startDate,
          startTime,
          cycles,
          totalPrice: totalPrice.trim() === "" ? null : Number(totalPrice),
        }),
      });
      if (!response.ok) throw new Error(String(response.status));
      router.refresh();
      onClose();
    } catch {
      setError(labels.failed);
    } finally {
      setBusy(false);
    }
  }

  const fieldClass =
    "h-9 w-full rounded-md border border-[var(--line)] bg-white px-2.5 text-[12px] text-[color:var(--ink)] outline-none focus:border-[var(--accent)]";

  return (
    <div className="fixed inset-0 z-[85] flex items-end justify-center bg-[var(--ink)]/40 backdrop-blur-sm sm:items-center sm:p-4">
      <button type="button" aria-label={labels.cancel} className="absolute inset-0" onClick={onClose} />
      <div className="relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl border border-[var(--line)] bg-white shadow-2xl sm:max-h-[90vh] sm:w-[min(44rem,calc(100vw-2rem))] sm:rounded-lg">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-[var(--ink)]">{labels.title}</h2>
            <p className="mt-0.5 text-xs text-[color:var(--ink-soft)]">{labels.subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={labels.cancel}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--line)] bg-white"
          >
            ×
          </button>
        </div>

        <div className="grid gap-2.5 overflow-y-auto p-4">
          <label className="grid gap-1 text-[11px] font-semibold text-[color:var(--ink-soft)]">
            {labels.vehicle}
            <SearchableSelect
              value={vehicleId}
              onChange={setVehicleId}
              options={vehicleOptions.map((vehicle) => ({
                value: vehicle.id,
                label: vehicle.plateNumber || vehicle.label,
              }))}
            />
          </label>

          <div className="grid gap-2.5 sm:grid-cols-2">
            <label className="grid gap-1 text-[11px] font-semibold text-[color:var(--ink-soft)]">
              {labels.renter}
              <input
                value={renterName}
                onChange={(event) => setRenterName(event.target.value)}
                className={fieldClass}
              />
            </label>
            <label className="grid gap-1 text-[11px] font-semibold text-[color:var(--ink-soft)]">
              {labels.phone}
              <input
                value={renterPhone}
                inputMode="tel"
                onChange={(event) => setRenterPhone(event.target.value)}
                className={fieldClass}
              />
            </label>
          </div>

          <div className="grid gap-2.5 sm:grid-cols-4">
            <label className="grid gap-1 text-[11px] font-semibold text-[color:var(--ink-soft)]">
              {labels.startDate}
              <input
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
                className={fieldClass}
              />
            </label>
            <label className="grid gap-1 text-[11px] font-semibold text-[color:var(--ink-soft)]">
              {labels.startTime}
              <input
                type="time"
                value={startTime}
                onChange={(event) => setStartTime(event.target.value)}
                className={fieldClass}
              />
            </label>
            <label className="grid gap-1 text-[11px] font-semibold text-[color:var(--ink-soft)]">
              {labels.cycles}
              <input
                type="number"
                min={1}
                max={60}
                value={cycles}
                onChange={(event) =>
                  setCycles(Math.max(1, Math.min(60, Number(event.target.value) || 1)))
                }
                className={fieldClass}
              />
            </label>
            <label className="grid gap-1 text-[11px] font-semibold text-[color:var(--ink-soft)]">
              {labels.price}
              <input
                value={totalPrice}
                inputMode="decimal"
                onChange={(event) => setTotalPrice(event.target.value)}
                className={fieldClass}
              />
            </label>
          </div>

          {preview.length > 0 ? (
            <div className="rounded-md border border-[var(--line)] bg-[var(--surface-muted)]/50 p-2">
              <p className="mb-1 text-[11px] font-semibold text-[color:var(--ink-soft)]">
                {labels.preview(preview.length)}
              </p>
              <ol className="grid max-h-56 gap-0.5 overflow-y-auto text-[11.5px]">
                {preview.map((cycle) => (
                  <li
                    key={cycle.cycle}
                    className={cn(
                      "flex flex-wrap items-center justify-between gap-2 rounded px-1.5 py-1",
                      cycle.conflicts.length > 0
                        ? "bg-rose-50 text-rose-800"
                        : "text-[color:var(--ink)]",
                    )}
                  >
                    <span className="tabular-nums">
                      {cycle.cycle}. {formatDateTime(cycle.pickupDatetime, locale)} →{" "}
                      {formatDateTime(cycle.returnDatetime, locale)}
                    </span>
                    {cycle.conflicts.length > 0 ? (
                      <span className="font-semibold">
                        {labels.conflict}: {cycle.conflicts.map((c) => c.renterName).join(", ")}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ol>
            </div>
          ) : null}

          {error ? (
            <p className="rounded-md bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{error}</p>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--line)] px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:pb-3">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 items-center rounded-md border border-[var(--line)] bg-white px-3.5 text-[12px] font-semibold text-[var(--ink)]"
          >
            {labels.cancel}
          </button>
          <button
            type="button"
            onClick={() => void create()}
            disabled={busy || !vehicleId}
            className="inline-flex h-9 items-center rounded-md bg-[var(--accent)] px-3.5 text-[12px] font-semibold text-white disabled:opacity-50"
          >
            {busy ? labels.creating : labels.create}
          </button>
        </div>
      </div>
    </div>
  );
}
