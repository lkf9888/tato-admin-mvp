"use client";

import { useMemo, useState, useTransition } from "react";

import { getMessages, type Locale } from "@/lib/i18n";
import { cn, formatCurrency } from "@/lib/utils";

/**
 * A month of one car's prices, editable a day or a stretch at a time.
 *
 * Days show what would actually be charged: a hand-set price where
 * there is one, the vehicle's own rate otherwise. The two are drawn
 * differently, because the whole question an operator opens this to
 * answer is "which of these did I set myself".
 */

export type PricingCalendarVehicle = {
  id: string;
  label: string;
  baseRate: number;
  rateSource: "manual" | "suggested";
};

const DAY_MS = 86_400_000;

function toKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function monthStart(year: number, month: number) {
  return new Date(Date.UTC(year, month, 1, 12));
}

export function PricingCalendar({
  locale,
  vehicles,
  vehicleId,
  overrides,
  bookedDates,
  year,
  month,
}: {
  locale: Locale;
  vehicles: PricingCalendarVehicle[];
  vehicleId: string;
  overrides: Record<string, number>;
  bookedDates: string[];
  /** Full year, and 0-indexed month, of the grid being shown. */
  year: number;
  month: number;
}) {
  const copy = getMessages(locale).pricingCalendarPage;
  const vehicle = vehicles.find((item) => item.id === vehicleId) ?? vehicles[0];
  const [selection, setSelection] = useState<string[]>([]);
  const [price, setPrice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const booked = useMemo(() => new Set(bookedDates), [bookedDates]);

  const cells = useMemo(() => {
    const first = monthStart(year, month);
    // Monday-first, matching the rest of the app's calendars.
    const lead = (first.getUTCDay() + 6) % 7;
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0, 12)).getUTCDate();
    const out: (string | null)[] = Array.from({ length: lead }, () => null);
    for (let day = 1; day <= daysInMonth; day += 1) {
      out.push(toKey(new Date(Date.UTC(year, month, day, 12))));
    }
    return out;
  }, [year, month]);

  function toggle(key: string) {
    setError(null);
    setSelection((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
    );
  }

  function apply(clear: boolean) {
    if (!vehicle || selection.length === 0) return;
    const value = Number(price);
    if (!clear && (!Number.isFinite(value) || value <= 0)) {
      setError(copy.priceRequired);
      return;
    }

    const sorted = [...selection].sort();
    setError(null);
    startTransition(async () => {
      // One call per contiguous run, so picking three scattered days
      // does not price everything between the first and the last.
      const runs: [string, string][] = [];
      for (const key of sorted) {
        const last = runs[runs.length - 1];
        if (last && toKey(new Date(new Date(`${last[1]}T12:00:00Z`).getTime() + DAY_MS)) === key) {
          last[1] = key;
        } else {
          runs.push([key, key]);
        }
      }

      for (const [fromDate, toDate] of runs) {
        const response = await fetch(`/api/vehicles/${vehicle.id}/price-overrides`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ fromDate, toDate, price: clear ? null : value }),
        });
        if (!response.ok) {
          setError(copy.saveFailed);
          return;
        }
      }
      window.location.reload();
    });
  }

  if (!vehicle) return null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <form method="get" className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="year" value={year} />
          <input type="hidden" name="month" value={month + 1} />
          <select
            name="vehicleId"
            defaultValue={vehicle.id}
            onChange={(event) => event.currentTarget.form?.requestSubmit()}
            className="rounded-md border border-[color:var(--line)] bg-[var(--surface-muted)] px-3 py-2 text-[13px] text-[color:var(--ink)]"
          >
            {vehicles.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </form>

        <span className="text-[12px] text-[color:var(--ink-soft)]">
          {copy.baseRateLabel}: {formatCurrency(vehicle.baseRate, locale)}
          {vehicle.rateSource === "suggested" ? ` · ${copy.aiPriced}` : ""}
        </span>
      </div>

      <div className="flex items-center justify-between rounded-lg border border-[color:var(--line)] bg-[rgba(255,255,255,0.88)] px-3 py-2">
        <a
          href={`?vehicleId=${vehicle.id}&year=${month === 0 ? year - 1 : year}&month=${month === 0 ? 12 : month}`}
          className="rounded-md border border-[color:var(--line-strong)] px-2.5 py-1 text-[12px] text-[color:var(--ink-mid)]"
        >
          ←
        </a>
        <span className="text-[13px] font-semibold text-[color:var(--ink)]">
          {year} / {String(month + 1).padStart(2, "0")}
        </span>
        <a
          href={`?vehicleId=${vehicle.id}&year=${month === 11 ? year + 1 : year}&month=${month === 11 ? 1 : month + 2}`}
          className="rounded-md border border-[color:var(--line-strong)] px-2.5 py-1 text-[12px] text-[color:var(--ink-mid)]"
        >
          →
        </a>
      </div>

      <div className="rounded-lg border border-[color:var(--line)] bg-[rgba(255,255,255,0.88)] p-3">
        <div className="grid grid-cols-7 gap-1 text-center text-[10px] uppercase tracking-[0.12em] text-[color:var(--ink-soft)]">
          {copy.weekdays.map((day) => (
            <span key={day}>{day}</span>
          ))}
        </div>
        <div className="mt-2 grid grid-cols-7 gap-1">
          {cells.map((key, index) => {
            if (!key) return <span key={`pad-${index}`} />;
            const override = overrides[key];
            const isSelected = selection.includes(key);
            const isBooked = booked.has(key);

            return (
              <button
                key={key}
                type="button"
                onClick={() => toggle(key)}
                className={cn(
                  "flex min-h-[3.4rem] flex-col items-center justify-center rounded-md border px-1 py-1.5 text-[11px] transition",
                  isSelected
                    ? "border-[var(--brand)] bg-[var(--brand-soft)]"
                    : "border-[color:var(--line)] bg-white",
                  isBooked ? "opacity-55" : "",
                )}
              >
                <span className="text-[color:var(--ink-soft)]">{Number(key.slice(8))}</span>
                <span
                  className={cn(
                    "mt-0.5 tabular-nums",
                    override != null
                      ? "font-semibold text-[color:var(--ink)]"
                      : "text-[color:var(--ink-soft)]",
                  )}
                >
                  {formatCurrency(override ?? vehicle.baseRate, locale)}
                </span>
                {isBooked ? (
                  <span className="text-[9px] text-[color:var(--ink-soft)]">{copy.bookedTag}</span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-lg border border-[color:var(--line)] bg-[rgba(255,255,255,0.88)] px-3 py-3">
        <p className="text-[12px] text-[color:var(--ink-soft)]">
          {selection.length === 0 ? copy.selectHint : copy.selectedCount(selection.length)}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            type="number"
            min="1"
            step="1"
            inputMode="decimal"
            value={price}
            onChange={(event) => setPrice(event.target.value)}
            placeholder={String(Math.round(vehicle.baseRate))}
            className="w-32 rounded-md border border-[color:var(--line)] bg-[var(--surface-muted)] px-3 py-2 text-[13px] tabular-nums text-[color:var(--ink)]"
          />
          <button
            type="button"
            disabled={pending || selection.length === 0}
            onClick={() => apply(false)}
            className="rounded-md bg-[var(--ink)] px-4 py-2 text-[12px] font-medium text-white disabled:opacity-50"
            style={{ backgroundColor: "var(--ink)", color: "#ffffff" }}
          >
            {copy.applyAction}
          </button>
          <button
            type="button"
            disabled={pending || selection.length === 0}
            onClick={() => apply(true)}
            className="rounded-md border border-[color:var(--line-strong)] px-3 py-2 text-[12px] text-[color:var(--ink-mid)] disabled:opacity-50"
          >
            {copy.clearAction}
          </button>
          {selection.length > 0 ? (
            <button
              type="button"
              onClick={() => setSelection([])}
              className="text-[12px] text-[color:var(--ink-soft)] underline"
            >
              {copy.deselectAction}
            </button>
          ) : null}
        </div>
        {error ? (
          <p className="mt-2 text-[12px] text-[color:var(--bad-fg)]">{error}</p>
        ) : null}
      </div>
    </div>
  );
}
