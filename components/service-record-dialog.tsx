"use client";

import { useEffect, useState } from "react";
import { Trash2, Wrench } from "lucide-react";

import { CloseButton } from "@/components/back-button";
import { SearchableSelect } from "@/components/searchable-select";
import { getMessages, type Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export type ServiceKind = "repair" | "maintenance" | "mileage" | "other";

export type ServiceRecord = {
  id: string;
  vehicleId: string;
  startDate: string;
  endDate: string;
  kind: ServiceKind;
  description: string;
  mileage: number | null;
  cost: number | null;
};

const KINDS: ServiceKind[] = ["maintenance", "repair", "mileage", "other"];

const field =
  "h-9 w-full min-w-0 rounded-md border border-[var(--line)] bg-white px-2.5 text-[13px] text-[var(--ink)] outline-none focus:border-[var(--accent)]";

/**
 * Write or change one repair, service or odometer reading. Opened from
 * the calendar's toolbar, from a selection of days, or by tapping a
 * yellow band. Saving returns the record for the calendar to draw.
 */
export function ServiceRecordDialog({
  locale,
  vehicles,
  record,
  seed,
  onClose,
  onSaved,
  onDeleted,
}: {
  locale: Locale;
  vehicles: Array<{ id: string; label: string; plateNumber?: string | null }>;
  /** Editing this one; absent for a new record. */
  record?: ServiceRecord | null;
  /** Where a new record starts: a car and days. */
  seed?: { vehicleId: string; startDate: string; endDate: string };
  onClose: () => void;
  onSaved: (record: ServiceRecord) => void;
  onDeleted: (id: string) => void;
}) {
  const t = getMessages(locale).calendar.service;
  const start = record ?? seed;
  const [vehicleId, setVehicleId] = useState(start?.vehicleId ?? vehicles[0]?.id ?? "");
  const [startDate, setStartDate] = useState(start?.startDate ?? "");
  const [endDate, setEndDate] = useState(start?.endDate ?? start?.startDate ?? "");
  const [kind, setKind] = useState<ServiceKind>(record?.kind ?? "maintenance");
  const [description, setDescription] = useState(record?.description ?? "");
  const [mileage, setMileage] = useState(record?.mileage != null ? String(record.mileage) : "");
  const [cost, setCost] = useState(record?.cost != null ? String(record.cost) : "");
  const [busy, setBusy] = useState<"save" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy("save");
    setError(null);
    const response = await fetch(record ? `/api/calendar/service-records/${record.id}` : "/api/calendar/service-records", {
      method: record ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vehicleId,
        startDate,
        endDate: endDate || startDate,
        kind,
        description,
        mileage: mileage.trim() ? Math.round(Number(mileage.replace(/[,\s]/g, ""))) : null,
        cost: cost.trim() ? Number(cost) : null,
      }),
    }).catch(() => null);
    const payload = response ? await response.json().catch(() => null) : null;
    setBusy(null);
    if (!response?.ok || !payload?.record) {
      setError(t.failed);
      return;
    }
    onSaved(payload.record as ServiceRecord);
  }

  async function remove() {
    if (!record || busy || !window.confirm(t.removeConfirm)) return;
    setBusy("delete");
    const response = await fetch(`/api/calendar/service-records/${record.id}`, { method: "DELETE" }).catch(() => null);
    setBusy(null);
    if (!response?.ok) {
      setError(t.failed);
      return;
    }
    onDeleted(record.id);
  }

  return (
    <div
      className="fixed inset-0 z-[95] flex items-end justify-center bg-[var(--ink)]/35 sm:items-center sm:p-4"
      onClick={() => !busy && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label={record ? t.editTitle : t.createTitle}
    >
      <form
        onSubmit={save}
        onClick={(event) => event.stopPropagation()}
        className="tato-sheet-up grid max-h-[92dvh] w-full gap-2.5 overflow-y-auto rounded-t-2xl border border-amber-300 bg-white p-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] shadow-[0_28px_70px_-28px_rgba(17,19,24,0.55)] sm:max-w-lg sm:rounded-lg sm:p-4"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold text-[var(--ink)]">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-amber-300 text-amber-950">
              <Wrench className="h-4 w-4" aria-hidden />
            </span>
            {record ? t.editTitle : t.createTitle}
          </h2>
          <CloseButton onClick={() => !busy && onClose()} label={t.cancel} />
        </div>

        <label className="grid gap-1 text-[12px] text-[var(--ink-soft)]">
          {t.vehicle}
          <SearchableSelect
            value={vehicleId}
            onChange={setVehicleId}
            options={vehicles.map((vehicle) => ({
              value: vehicle.id,
              label:
                vehicle.plateNumber && vehicle.plateNumber !== vehicle.label
                  ? `${vehicle.plateNumber} · ${vehicle.label}`
                  : vehicle.label,
              searchText: [vehicle.plateNumber, vehicle.label].filter(Boolean).join(" "),
            }))}
            placeholder={t.vehicle}
            searchPlaceholder={t.vehicle}
          />
        </label>

        <div className="grid grid-cols-2 gap-2">
          <label className="grid gap-1 text-[12px] text-[var(--ink-soft)]">
            {t.startDate}
            <input
              type="date"
              required
              value={startDate}
              onChange={(event) => {
                setStartDate(event.target.value);
                if (!endDate || endDate < event.target.value) setEndDate(event.target.value);
              }}
              className={field}
            />
          </label>
          <label className="grid gap-1 text-[12px] text-[var(--ink-soft)]">
            {t.endDate}
            <input
              type="date"
              value={endDate}
              min={startDate || undefined}
              onChange={(event) => setEndDate(event.target.value)}
              className={field}
            />
          </label>
        </div>

        <fieldset className="grid gap-1 text-[12px] text-[var(--ink-soft)]">
          <legend className="mb-1">{t.kind}</legend>
          <div className="grid grid-cols-4 gap-1 rounded-md bg-[var(--surface-muted)] p-0.5">
            {KINDS.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={kind === value}
                onClick={() => setKind(value)}
                className={cn(
                  "h-8 rounded-[5px] text-[12px] font-semibold transition",
                  kind === value ? "bg-amber-300 text-amber-950 shadow-sm" : "text-[var(--ink-soft)] hover:text-[var(--ink)]",
                )}
              >
                {t.kinds[value]}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="grid grid-cols-2 gap-2">
          <label className="grid gap-1 text-[12px] text-[var(--ink-soft)]">
            {t.mileage}
            <input
              inputMode="numeric"
              autoComplete="off"
              value={mileage}
              onChange={(event) => setMileage(event.target.value)}
              className={cn(field, "tabular-nums")}
            />
          </label>
          <label className="grid gap-1 text-[12px] text-[var(--ink-soft)]">
            {t.cost}
            <input
              type="number"
              step="0.01"
              min="0"
              value={cost}
              onChange={(event) => setCost(event.target.value)}
              className={cn(field, "tabular-nums")}
            />
          </label>
        </div>

        <label className="grid gap-1 text-[12px] text-[var(--ink-soft)]">
          {t.description}
          <textarea
            rows={3}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={t.descriptionPlaceholder}
            className="w-full min-w-0 resize-y rounded-md border border-[var(--line)] bg-white px-2.5 py-2 text-[13px] text-[var(--ink)] outline-none focus:border-[var(--accent)]"
          />
        </label>

        {error ? <p className="rounded-md bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{error}</p> : null}

        <div className="flex items-center justify-between gap-2 pt-1">
          {record ? (
            <button
              type="button"
              onClick={() => void remove()}
              disabled={busy !== null}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-rose-200 bg-white px-3 text-[12px] font-semibold text-rose-600 transition hover:border-rose-400 disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
              {t.remove}
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy !== null}
              className="inline-flex h-9 items-center rounded-md border border-[var(--line)] bg-white px-3 text-[12px] font-semibold text-[var(--ink)] disabled:opacity-50"
            >
              {t.cancel}
            </button>
            <button
              type="submit"
              disabled={busy !== null || !vehicleId || !startDate}
              className="inline-flex h-9 items-center rounded-md bg-amber-400 px-4 text-[12px] font-semibold text-amber-950 transition hover:bg-amber-500 disabled:opacity-50"
            >
              {busy === "save" ? t.saving : t.save}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
