"use client";

import { useMemo, useState } from "react";

import { getMessages, type Locale } from "@/lib/i18n";
import { cn, formatCurrency } from "@/lib/utils";

export type PriceChange = { vehicleId: string; date: string; price: number | null };

type Mode = "fixed" | "percent" | "amount" | "reset";

type CarOption = { id: string; label: string; plateNumber: string };

const DAY_MS = 86_400_000;
/** Longer than this is a slip of the date picker, not a season. */
const MAX_RANGE_DAYS = 400;
/** Monday first, as the operator reads a week. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

function weekdayOf(dayKey: string) {
  return new Date(`${dayKey}T12:00:00.000Z`).getUTCDay();
}

function enumerateRange(from: string, to: string) {
  if (!from || !to || to < from) return [];
  const out: string[] = [];
  let cursor = new Date(`${from}T12:00:00.000Z`).getTime();
  const end = new Date(`${to}T12:00:00.000Z`).getTime();
  while (cursor <= end && out.length < MAX_RANGE_DAYS) {
    out.push(new Date(cursor).toISOString().slice(0, 10));
    cursor += DAY_MS;
  }
  return out;
}

/**
 * Price many days on many cars at once, the way Hostex and Airbnb's
 * calendars do: pick the days, pick the cars, say what to do -- a fixed
 * price, up or down by a percentage or an amount, or back to the car's
 * own rate -- and see every change before it is saved.
 *
 * Adjustments start from what each day costs now (a hand-set price if
 * it has one, otherwise the car's rate for that day), rounded to whole
 * dollars. Nothing here decides a price the server would not: the
 * result is written as hand-set days, the same rows the single-day
 * editor writes.
 */
export function CalendarPricePanel({
  locale,
  cars,
  initialVehicleIds,
  initialDays,
  resolveDayPrice,
  onClose,
  onSaved,
}: {
  locale: Locale;
  /** Cars open for direct booking; only they have a price worth setting. */
  cars: CarOption[];
  initialVehicleIds: string[];
  /** The days picked on the grid, sorted; empty opens on the next 30 days. */
  initialDays: string[];
  resolveDayPrice: (vehicleId: string, dayKey: string) => { price: number; fixed: boolean } | null;
  onClose: () => void;
  onSaved: (changes: PriceChange[]) => void;
}) {
  const copy = getMessages(locale).calendarPricePanel;
  const weekdayNames = copy.weekdays;

  const initialIsRun =
    initialDays.length > 0 &&
    enumerateRange(initialDays[0], initialDays[initialDays.length - 1]).length === initialDays.length;
  const today = new Date();
  const todayKey = new Date(today.getTime() - today.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 10);
  // Scattered picks are priced exactly as picked; a run can be widened.
  const [useExactDays] = useState(initialDays.length > 0 && !initialIsRun);
  const [fromDate, setFromDate] = useState(initialDays[0] ?? todayKey);
  const [toDate, setToDate] = useState(
    initialDays[initialDays.length - 1] ??
      new Date(new Date(`${todayKey}T12:00:00.000Z`).getTime() + 29 * DAY_MS).toISOString().slice(0, 10),
  );
  const [weekdays, setWeekdays] = useState<Set<number>>(new Set(WEEK_ORDER));
  const [vehicleIds, setVehicleIds] = useState<Set<string>>(
    new Set(initialVehicleIds.filter((id) => cars.some((car) => car.id === id))),
  );
  const [carQuery, setCarQuery] = useState("");
  const [mode, setMode] = useState<Mode>("fixed");
  const [direction, setDirection] = useState<1 | -1>(1);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const days = useMemo(() => {
    const base = useExactDays ? initialDays : enumerateRange(fromDate, toDate);
    return base.filter((day) => weekdays.has(weekdayOf(day)));
  }, [useExactDays, initialDays, fromDate, toDate, weekdays]);

  const numeric = Number(value);
  const valueReady = mode === "reset" || (value.trim() !== "" && Number.isFinite(numeric) && numeric > 0);

  // Every change the save would make, worked out here so the preview
  // and the request are the same list.
  const preview = useMemo(() => {
    const changes: PriceChange[] = [];
    const perCar: Array<{ car: CarOption; count: number; oldMin: number; oldMax: number; newMin: number; newMax: number }> = [];
    if (!valueReady) return { changes, perCar, unpriced: 0 };
    let unpriced = 0;
    for (const car of cars) {
      if (!vehicleIds.has(car.id)) continue;
      let count = 0;
      let oldMin = Infinity;
      let oldMax = -Infinity;
      let newMin = Infinity;
      let newMax = -Infinity;
      for (const day of days) {
        const current = resolveDayPrice(car.id, day);
        if (!current) {
          unpriced += 1;
          continue;
        }
        let next: number | null;
        if (mode === "reset") {
          if (!current.fixed) continue;
          next = null;
        } else if (mode === "fixed") {
          next = Math.round(numeric * 100) / 100;
        } else if (mode === "percent") {
          next = Math.round(current.price * (1 + (direction * numeric) / 100));
        } else {
          next = Math.round(current.price + direction * numeric);
        }
        if (next != null) {
          next = Math.max(1, next);
          if (current.fixed && Math.abs(next - current.price) < 0.005) continue;
        }
        changes.push({ vehicleId: car.id, date: day, price: next });
        count += 1;
        oldMin = Math.min(oldMin, current.price);
        oldMax = Math.max(oldMax, current.price);
        const shown = next ?? NaN;
        if (Number.isFinite(shown)) {
          newMin = Math.min(newMin, shown);
          newMax = Math.max(newMax, shown);
        }
      }
      if (count > 0) perCar.push({ car, count, oldMin, oldMax, newMin, newMax });
    }
    return { changes, perCar, unpriced };
  }, [cars, vehicleIds, days, mode, numeric, direction, valueReady, resolveDayPrice]);

  const money = (amount: number) => formatCurrency(Math.round(amount), locale).replace(/\.00$/, "");
  const range = (min: number, max: number) =>
    Math.round(min) === Math.round(max) ? money(min) : `${money(min)}–${money(max)}`;

  async function save() {
    if (preview.changes.length === 0) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/direct-booking/price-overrides", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ changes: preview.changes }),
      });
      if (!response.ok) {
        setError(copy.saveFailed);
        return;
      }
      onSaved(preview.changes);
    } catch {
      setError(copy.saveFailed);
    } finally {
      setSaving(false);
    }
  }

  const visibleCars = cars.filter((car) => {
    const query = carQuery.trim().toLowerCase();
    return !query || `${car.plateNumber} ${car.label}`.toLowerCase().includes(query);
  });
  const field =
    "h-8 w-full rounded-md border border-[var(--line)] bg-white px-2 text-[12px] text-[color:var(--ink)] outline-none focus:border-[var(--accent)]";
  const chip = (active: boolean) =>
    cn(
      "rounded-md border px-2 py-1 text-[11px] transition",
      active
        ? "border-[var(--ink)] bg-[var(--ink)] text-white"
        : "border-[var(--line)] bg-white text-[color:var(--ink-mid)] hover:border-[var(--line-strong)]",
    );

  return (
    <div className="fixed inset-0 z-[70] flex justify-end bg-[rgba(17,19,24,0.18)]" onClick={onClose}>
      <aside
        onClick={(event) => event.stopPropagation()}
        className="flex h-full w-full max-w-[420px] flex-col border-l border-[color:var(--line)] bg-white shadow-[-24px_0_60px_-40px_rgba(17,19,24,0.6)]"
        aria-label={copy.title}
      >
        <div className="flex items-center justify-between border-b border-[color:var(--line)] px-4 py-3">
          <h2 className="text-[15px] font-semibold text-[color:var(--ink)]">{copy.title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-[12px] text-[color:var(--ink-soft)] hover:bg-[var(--surface-muted)]"
          >
            {copy.close}
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3 text-[12px]">
          {/* Dates */}
          <section>
            <p className="mb-1.5 font-medium text-[color:var(--ink)]">{copy.datesLabel}</p>
            {useExactDays ? (
              <p className="text-[color:var(--ink-mid)]">{copy.exactDays(initialDays.length)}</p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} className={field} aria-label={copy.fromLabel} />
                <input type="date" value={toDate} min={fromDate} onChange={(event) => setToDate(event.target.value)} className={field} aria-label={copy.toLabel} />
              </div>
            )}
            <div className="mt-2 flex flex-wrap gap-1">
              <button type="button" className={chip(weekdays.size === 7)} onClick={() => setWeekdays(new Set(WEEK_ORDER))}>
                {copy.everyDay}
              </button>
              <button
                type="button"
                className={chip(weekdays.size === 2 && weekdays.has(5) && weekdays.has(6))}
                onClick={() => setWeekdays(new Set([5, 6]))}
                title={copy.weekendHint}
              >
                {copy.weekend}
              </button>
              <button
                type="button"
                className={chip(weekdays.size === 5 && ![0, 6].some((day) => weekdays.has(day)))}
                onClick={() => setWeekdays(new Set([1, 2, 3, 4, 5]))}
              >
                {copy.weekdaysOnly}
              </button>
            </div>
            <div className="mt-1.5 flex gap-1">
              {WEEK_ORDER.map((day) => (
                <button
                  key={day}
                  type="button"
                  aria-pressed={weekdays.has(day)}
                  onClick={() =>
                    setWeekdays((current) => {
                      const next = new Set(current);
                      if (next.has(day)) next.delete(day);
                      else next.add(day);
                      return next;
                    })
                  }
                  className={cn(chip(weekdays.has(day)), "flex-1 px-0")}
                >
                  {weekdayNames[day]}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-[color:var(--ink-soft)]">{copy.daysCount(days.length)}</p>
          </section>

          {/* Cars */}
          <section>
            <div className="mb-1.5 flex items-center justify-between">
              <p className="font-medium text-[color:var(--ink)]">{copy.carsLabel(vehicleIds.size)}</p>
              <span className="flex gap-2 text-[11px]">
                <button type="button" className="text-[color:var(--accent)]" onClick={() => setVehicleIds(new Set(cars.map((car) => car.id)))}>
                  {copy.selectAll}
                </button>
                <button type="button" className="text-[color:var(--ink-soft)]" onClick={() => setVehicleIds(new Set())}>
                  {copy.selectNone}
                </button>
              </span>
            </div>
            {cars.length > 8 ? (
              <input value={carQuery} onChange={(event) => setCarQuery(event.target.value)} placeholder={copy.carSearch} className={cn(field, "mb-1.5")} />
            ) : null}
            <div className="max-h-44 space-y-0.5 overflow-y-auto rounded-md border border-[var(--line)] p-1">
              {cars.length === 0 ? (
                <p className="px-1 py-2 text-[color:var(--ink-soft)]">{copy.noBookableCars}</p>
              ) : null}
              {visibleCars.map((car) => (
                <label key={car.id} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 hover:bg-[var(--surface-muted)]">
                  <input
                    type="checkbox"
                    checked={vehicleIds.has(car.id)}
                    onChange={(event) =>
                      setVehicleIds((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(car.id);
                        else next.delete(car.id);
                        return next;
                      })
                    }
                  />
                  <span className="font-medium tabular-nums text-[color:var(--ink)]">{car.plateNumber}</span>
                  <span className="truncate text-[color:var(--ink-soft)]">{car.label}</span>
                </label>
              ))}
            </div>
          </section>

          {/* What to do */}
          <section>
            <p className="mb-1.5 font-medium text-[color:var(--ink)]">{copy.actionLabel}</p>
            <div className="grid grid-cols-2 gap-1">
              {(["fixed", "percent", "amount", "reset"] as const).map((item) => (
                <button key={item} type="button" className={chip(mode === item)} onClick={() => setMode(item)}>
                  {copy.modes[item]}
                </button>
              ))}
            </div>
            {mode === "reset" ? (
              <p className="mt-2 text-[11px] leading-4 text-[color:var(--ink-soft)]">{copy.resetHint}</p>
            ) : (
              <div className="mt-2 flex items-center gap-2">
                {mode !== "fixed" ? (
                  <div className="flex shrink-0 overflow-hidden rounded-md border border-[var(--line)]">
                    {([1, -1] as const).map((sign) => (
                      <button
                        key={sign}
                        type="button"
                        onClick={() => setDirection(sign)}
                        className={cn(
                          "h-8 px-2.5 text-[12px]",
                          direction === sign ? "bg-[var(--ink)] text-white" : "bg-white text-[color:var(--ink-mid)]",
                        )}
                      >
                        {sign === 1 ? copy.raise : copy.lower}
                      </button>
                    ))}
                  </div>
                ) : null}
                <input
                  type="number"
                  min="0"
                  step="1"
                  inputMode="decimal"
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  placeholder={mode === "percent" ? "10" : mode === "amount" ? "15" : "89"}
                  className={cn(field, "w-24 tabular-nums")}
                  aria-label={copy.modes[mode]}
                />
                <span className="text-[color:var(--ink-soft)]">
                  {mode === "percent" ? "%" : mode === "amount" ? copy.perDayDelta : copy.perDay}
                </span>
              </div>
            )}
            {mode === "percent" || mode === "amount" ? (
              <p className="mt-1 text-[11px] text-[color:var(--ink-soft)]">{copy.adjustHint}</p>
            ) : null}
          </section>

          {/* Preview */}
          <section>
            <p className="mb-1.5 font-medium text-[color:var(--ink)]">{copy.previewLabel}</p>
            {!valueReady ? (
              <p className="text-[color:var(--ink-soft)]">{copy.previewEmpty}</p>
            ) : preview.changes.length === 0 ? (
              <p className="text-[color:var(--ink-soft)]">{copy.previewNothing}</p>
            ) : (
              <>
                <p className="text-[color:var(--ink-mid)]">
                  {copy.previewSummary(preview.perCar.length, preview.changes.length)}
                </p>
                <div className="mt-1.5 max-h-56 overflow-y-auto rounded-md border border-[var(--line)]">
                  <table className="w-full text-[11px] tabular-nums">
                    <thead className="sticky top-0 bg-[var(--surface-muted)] text-left text-[color:var(--ink-soft)]">
                      <tr>
                        <th className="px-2 py-1 font-medium">{copy.colCar}</th>
                        <th className="px-2 py-1 font-medium">{copy.colDays}</th>
                        <th className="px-2 py-1 font-medium">{copy.colNow}</th>
                        <th className="px-2 py-1 font-medium">{copy.colNew}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.perCar.map((row) => (
                        <tr key={row.car.id} className="border-t border-[var(--line)]">
                          <td className="px-2 py-1 font-medium text-[color:var(--ink)]">{row.car.plateNumber}</td>
                          <td className="px-2 py-1">{row.count}</td>
                          <td className="px-2 py-1 text-[color:var(--ink-soft)]">{range(row.oldMin, row.oldMax)}</td>
                          <td className="px-2 py-1 font-semibold text-[color:var(--ink)]">
                            {mode === "reset" ? copy.backToRate : range(row.newMin, row.newMax)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            {preview.unpriced > 0 && valueReady ? (
              <p className="mt-1 text-[11px] text-[color:var(--ink-soft)]">{copy.unpricedNote}</p>
            ) : null}
          </section>
        </div>

        <div className="flex items-center gap-2 border-t border-[color:var(--line)] px-4 py-3">
          {error ? <p className="min-w-0 flex-1 text-[11px] text-[color:var(--bad-fg)]">{error}</p> : <span className="flex-1" />}
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-md border border-[var(--line)] px-3 text-[12px] text-[color:var(--ink-mid)]"
          >
            {copy.cancel}
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || preview.changes.length === 0}
            className="h-9 rounded-md bg-[var(--ink)] px-4 text-[12px] font-semibold text-white disabled:opacity-50"
            style={{ backgroundColor: "var(--ink)", color: "#ffffff" }}
          >
            {saving ? copy.saving : copy.save(preview.changes.length)}
          </button>
        </div>
      </aside>
    </div>
  );
}
