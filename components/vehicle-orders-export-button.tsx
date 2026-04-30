"use client";

import { useState } from "react";

import { getMessages, type Locale } from "@/lib/i18n";

type VehicleExportOption = {
  id: string;
  label: string;
  plateNumber?: string | null;
  secondaryLabel?: string | null;
};

type VehicleOrdersExportButtonProps = {
  locale: Locale;
  vehicleOptions: VehicleExportOption[];
  preferredVehicleId?: string;
  rangeStart: string;
  rangeEnd: string;
};

function padNumber(value: number) {
  return value.toString().padStart(2, "0");
}

function formatDateInputValue(value: string) {
  const date = new Date(value);
  return `${date.getFullYear()}-${padNumber(date.getMonth() + 1)}-${padNumber(date.getDate())}`;
}

function getFilenameFromDisposition(disposition: string | null) {
  if (!disposition) return "vehicle-orders.xls";

  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1]);
  }

  const fallbackMatch = disposition.match(/filename="?([^";]+)"?/i);
  return fallbackMatch?.[1] ?? "vehicle-orders.xls";
}

export function VehicleOrdersExportButton({
  locale,
  vehicleOptions,
  preferredVehicleId,
  rangeStart,
  rangeEnd,
}: VehicleOrdersExportButtonProps) {
  const calendarMessages = getMessages(locale).calendar;
  const [isOpen, setIsOpen] = useState(false);
  const [vehicleId, setVehicleId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openDialog = () => {
    const defaultVehicleId =
      (preferredVehicleId && preferredVehicleId !== "all" ? preferredVehicleId : undefined) ??
      vehicleOptions[0]?.id ??
      "";

    setVehicleId(defaultVehicleId);
    setStartDate(formatDateInputValue(rangeStart));
    setEndDate(formatDateInputValue(rangeEnd));
    setError(null);
    setIsOpen(true);
  };

  const closeDialog = () => {
    if (isDownloading) return;
    setIsOpen(false);
    setError(null);
  };

  const handleDownload = async () => {
    if (!vehicleId || !startDate || !endDate || endDate < startDate) {
      setError(calendarMessages.exportValidationError);
      return;
    }

    setIsDownloading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        vehicleId,
        startDate,
        endDate,
        locale,
      });

      const response = await fetch(`/api/exports/vehicle-orders?${params.toString()}`, {
        method: "GET",
      });

      if (!response.ok) {
        setError(calendarMessages.exportError);
        return;
      }

      const blob = await response.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = getFilenameFromDisposition(response.headers.get("content-disposition"));
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(downloadUrl);
      setIsOpen(false);
    } catch {
      setError(calendarMessages.exportError);
    } finally {
      setIsDownloading(false);
    }
  };

  // v0.19.3 visual refresh — match the new flat-chip language used in
  // calendar-view's secondaryActionClass / primaryActionClass. Keeping
  // styles inline rather than extracting because there's no shared
  // module for buttons yet (when there are 3+ duplicates we should
  // promote them to `components/ui/button.tsx`).
  const triggerClass =
    "inline-flex h-9 items-center justify-center rounded-full border border-[var(--line)] bg-white px-3.5 text-[12px] font-semibold text-[var(--ink)] shadow-sm transition hover:border-[rgba(17,19,24,0.22)] hover:bg-[var(--surface-muted)] disabled:cursor-not-allowed disabled:opacity-50";
  const secondaryDialogClass =
    "inline-flex h-10 items-center justify-center rounded-full border border-[var(--line)] bg-white px-4 text-[12px] font-semibold text-[var(--ink)] transition hover:border-[rgba(17,19,24,0.22)] hover:bg-[var(--surface-muted)]";
  const primaryDialogClass =
    "inline-flex h-10 items-center justify-center rounded-full bg-[var(--accent)] px-4 text-[12px] font-semibold text-white shadow-[0_8px_22px_-10px_rgba(89,60,251,0.55)] transition hover:bg-[#4830d4] hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60";

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        disabled={vehicleOptions.length === 0}
        className={triggerClass}
      >
        {calendarMessages.downloadOrders}
      </button>

      {isOpen ? (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-950/35 p-4">
          <div className="w-full max-w-xl rounded-lg border border-[color:var(--line)] bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(247,247,247,0.98))] p-5 shadow-[0_28px_70px_-28px_rgba(17,19,24,0.55)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] uppercase tracking-[0.22em] text-[color:var(--ink-soft)]">
                  {calendarMessages.exportDialogTitle}
                </p>
                <p className="mt-2 max-w-xl text-[13px] leading-5 text-[color:var(--ink-soft)]">
                  {calendarMessages.exportDialogCopy}
                </p>
              </div>
              <button
                type="button"
                onClick={closeDialog}
                className={secondaryDialogClass}
              >
                {calendarMessages.cancelAction}
              </button>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <label className="grid gap-1.5 text-[11px] text-[color:var(--ink-soft)] sm:col-span-3">
                <span>{calendarMessages.vehicleField}</span>
                <select
                  value={vehicleId}
                  onChange={(event) => setVehicleId(event.target.value)}
                  className="rounded-md border border-[rgba(17,19,24,0.08)] bg-white/84 px-4 py-3 text-[13px] text-[color:var(--ink)] outline-none"
                >
                  {vehicleOptions.map((vehicle) => (
                    <option key={vehicle.id} value={vehicle.id}>
                      {vehicle.plateNumber
                        ? `${vehicle.plateNumber} · ${vehicle.label}`
                        : vehicle.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid gap-1.5 text-[11px] text-[color:var(--ink-soft)]">
                <span>{calendarMessages.startDateField}</span>
                <input
                  type="date"
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                  className="rounded-md border border-[rgba(17,19,24,0.08)] bg-white/84 px-4 py-3 text-[13px] text-[color:var(--ink)] outline-none"
                />
              </label>

              <label className="grid gap-1.5 text-[11px] text-[color:var(--ink-soft)]">
                <span>{calendarMessages.endDateField}</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                  className="rounded-md border border-[rgba(17,19,24,0.08)] bg-white/84 px-4 py-3 text-[13px] text-[color:var(--ink)] outline-none"
                />
              </label>
            </div>

            {error ? (
              <p className="mt-4 rounded-md bg-rose-50 px-4 py-3 text-[12px] text-rose-700">
                {error}
              </p>
            ) : null}

            <div className="mt-5 flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={closeDialog}
                className={secondaryDialogClass}
              >
                {calendarMessages.cancelAction}
              </button>
              <button
                type="button"
                onClick={handleDownload}
                disabled={isDownloading}
                className={primaryDialogClass}
              >
                {isDownloading ? calendarMessages.downloadingAction : calendarMessages.downloadAction}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
