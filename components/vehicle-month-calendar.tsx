"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { type EditableOrder } from "@/components/order-detail-modal";
import { getMessages, getStatusLabel, type Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { columnPosition } from "@/lib/calendar-window";

/**
 * One car, laid out as months instead of a strip.
 *
 * The main grid answers "which car is free next Tuesday" -- it is
 * wide because it compares cars. This answers "what does August look
 * like for this one car", which is a shape the strip cannot show: a
 * month on the timeline is three screens wide at a readable column
 * width, and on a phone it is nine.
 *
 * Deliberately not infinite: it opens on a range around today and
 * loads six months more at either end when asked. Endless scroll in
 * both directions is a nicer gesture and a much larger amount of
 * bookkeeping, and this view is something you open, read and close.
 */

type MonthOrder = Pick<
  EditableOrder,
  | "id"
  | "renterName"
  | "pickupDatetime"
  | "returnDatetime"
  | "status"
  | "source"
  | "hasConflict"
  | "ownerId"
  | "ownerLedgerSyncedAt"
  | "vehicleId"
>;

const MONTHS_BACK = 2;
const MONTHS_FORWARD = 9;
const MONTH_STEP = 6;
/** Beyond this the modal is a scroll nobody finishes; it says so
 *  rather than growing without limit. */
const MAX_MONTHS = 96;

function startOfDay(value: Date | string) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function addMonths(value: Date, amount: number) {
  const date = new Date(value);
  date.setMonth(date.getMonth() + amount, 1);
  date.setHours(0, 0, 0, 0);
  return date;
}

function isSameDay(a: Date, b: Date) {
  return startOfDay(a).getTime() === startOfDay(b).getTime();
}

/** Monday-first, which is how the main grid reads. */
function leadingBlanks(firstOfMonth: Date) {
  const weekday = firstOfMonth.getDay();
  return weekday === 0 ? 6 : weekday - 1;
}

/** The main calendar's colours (getTimelineBarClasses), so a trip looks the same in both. */
function barColour(order: MonthOrder) {
  if (order.hasConflict) return "border-[#c61e22] bg-[#e5484d] text-white";
  if (order.status === "cancelled") return "border-slate-500 bg-[var(--ink-soft)] text-white";
  if (order.ownerId && order.ownerLedgerSyncedAt) return "border-[#1f5b48] bg-[#2f7f67] text-white";
  if (order.source === "turo") return "border-[#1f3aa8] bg-[#3456df] text-white";
  return "border-[#1f5b48] bg-[#2f7f67] text-white";
}

type WeekBar = {
  order: MonthOrder;
  /** Fractions of the week's width, by the hour, as the main calendar places them. */
  left: number;
  width: number;
  lane: number;
  clippedStart: boolean;
  clippedEnd: boolean;
};

/**
 * One week of a month, as continuous bars rather than a chip per day:
 * a trip is drawn once from its pickup hour to its return hour, and is
 * only cut where the week or the month ends. Overlapping trips take
 * lanes, live trips before cancelled ones.
 */
function weekBars(orders: MonthOrder[], weekStart: Date, from: Date, to: Date): WeekBar[] {
  // The week ends at the next Monday's local midnight, and bars are
  // placed by local day: the weeks holding a clock change are 167 or
  // 169 hours, and a fixed 7x24h pushed the last hour of one into the
  // next row.
  const weekEnd = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 7).getTime();
  const start = Math.max(weekStart.getTime(), from.getTime());
  const end = Math.min(weekEnd, to.getTime());
  const touching = orders
    .filter((order) => new Date(order.pickupDatetime).getTime() < end && new Date(order.returnDatetime).getTime() > start)
    .sort(
      (a, b) =>
        Number(a.status === "cancelled") - Number(b.status === "cancelled") ||
        new Date(a.pickupDatetime).getTime() - new Date(b.pickupDatetime).getTime(),
    );
  const laneEnds: number[] = [];
  return touching.map((order) => {
    const pickup = new Date(order.pickupDatetime).getTime();
    const ret = new Date(order.returnDatetime).getTime();
    const barStart = Math.max(pickup, start);
    const barEnd = Math.min(ret, end);
    let lane = laneEnds.findIndex((laneEnd) => laneEnd <= barStart);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = barEnd;
    return {
      order,
      left: columnPosition(barStart, weekStart.getTime()) / 7,
      width: Math.max(
        (columnPosition(barEnd, weekStart.getTime()) - columnPosition(barStart, weekStart.getTime())) / 7,
        1 / 28,
      ),
      lane,
      clippedStart: pickup < start,
      clippedEnd: ret > end,
    };
  });
}

/** How many lanes of bars a week row has room to show before "+n". */
const MAX_LANES = 3;
const LANE_HEIGHT = 13;

export function VehicleMonthCalendar({
  locale,
  vehicleId,
  vehicleLabel,
  onClose,
  onSelectOrder,
}: {
  locale: Locale;
  vehicleId: string;
  vehicleLabel: string;
  onClose: () => void;
  onSelectOrder: (order: MonthOrder) => void;
}) {
  const messages = getMessages(locale).calendar;
  const [range, setRange] = useState({ back: MONTHS_BACK, forward: MONTHS_FORWARD });
  const [orders, setOrders] = useState<MonthOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const todayRef = useRef<HTMLDivElement | null>(null);

  const today = useMemo(() => startOfDay(new Date()), []);
  const months = useMemo(() => {
    const first = addMonths(today, -range.back);
    const count = Math.min(range.back + range.forward + 1, MAX_MONTHS);
    return Array.from({ length: count }, (_, index) => addMonths(first, index));
  }, [today, range]);

  const from = months[0];
  const to = addMonths(months[months.length - 1], 1);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const load = async () => {
      try {
        const response = await fetch(
          `/api/calendar/orders?vehicleId=${encodeURIComponent(vehicleId)}&from=${from
            .toISOString()
            .slice(0, 10)}&to=${to.toISOString().slice(0, 10)}`,
          { headers: { Accept: "application/json" } },
        );
        if (!response.ok) throw new Error(String(response.status));
        const data = (await response.json()) as { orders?: MonthOrder[] };
        if (cancelled) return;
        setOrders((data.orders ?? []).filter((order) => order.vehicleId === vehicleId));
        setFailed(false);
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicleId, from.getTime(), to.getTime()]);

  // Open on today rather than at the top, which would be two months of
  // history nobody asked to look at.
  useEffect(() => {
    todayRef.current?.scrollIntoView({ block: "center" });
    // Only on first paint: re-running this after "load earlier" would
    // snap the reader away from what they just revealed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const monthFormatter = new Intl.DateTimeFormat(locale === "en" ? "en-CA" : "zh-CN", {
    year: "numeric",
    month: "long",
  });
  const weekdayFormatter = new Intl.DateTimeFormat(locale === "en" ? "en-CA" : "zh-CN", {
    weekday: "short",
  });
  // Built from LOCAL dates, not `Date.UTC`.
  //
  // 2024-01-01 was a Monday, but `new Date(Date.UTC(2024, 0, 1))` is
  // Sunday 31 December once rendered anywhere west of Greenwich -- so
  // in Vancouver the header row came out Sun..Sat while the cells were
  // laid out Monday-first, and every date sat under the wrong weekday
  // name. `new Date(2024, 0, 1)` is local midnight and cannot drift.
  const weekdayHeaders = Array.from({ length: 7 }, (_, index) =>
    weekdayFormatter.format(new Date(2024, 0, 1 + index)),
  );

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-3 sm:p-4">
      <button
        type="button"
        aria-label={messages.cancelAction}
        className="absolute inset-0 bg-[var(--ink)]/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative flex max-h-[90vh] w-[min(52rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-lg border border-[var(--line)] bg-white shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-[var(--ink)]">{vehicleLabel}</h2>
            <p className="mt-0.5 text-xs text-[color:var(--ink-soft)]">
              {loading ? messages.monthLoading : messages.monthSubtitle(orders.length)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={messages.cancelAction}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--line)] bg-white text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
          >
            ×
          </button>
        </div>

        {failed ? (
          <p className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-[12px] text-amber-900">
            {messages.ordersLoadFailed}
          </p>
        ) : null}

        <div className="overflow-y-auto px-4 py-3">
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => setRange((current) => ({ ...current, back: current.back + MONTH_STEP }))}
              disabled={months.length >= MAX_MONTHS}
              className="mb-3 rounded-md border border-[var(--line)] bg-white px-3 py-1 text-[11px] font-semibold text-[color:var(--ink-soft)] transition hover:text-[var(--ink)] disabled:opacity-40"
            >
              {months.length >= MAX_MONTHS ? messages.monthMaxReached : messages.monthEarlier}
            </button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {months.map((month) => {
              const daysInMonth = new Date(
                month.getFullYear(),
                month.getMonth() + 1,
                0,
              ).getDate();
              const blanks = leadingBlanks(month);
              const isCurrentMonth =
                month.getFullYear() === today.getFullYear() &&
                month.getMonth() === today.getMonth();

              return (
                <div
                  key={month.toISOString()}
                  ref={isCurrentMonth ? todayRef : undefined}
                  className="rounded-lg border border-[var(--line)] p-2"
                >
                  <p className="mb-1.5 text-[12px] font-semibold text-[var(--ink)]">
                    {monthFormatter.format(month)}
                  </p>
                  <div className="grid grid-cols-7 text-center">
                    {weekdayHeaders.map((label) => (
                      <span
                        key={label}
                        className="pb-1 text-[9px] uppercase tracking-wide text-[color:var(--ink-soft)]"
                      >
                        {label}
                      </span>
                    ))}
                  </div>
                  {Array.from({ length: Math.ceil((blanks + daysInMonth) / 7) }, (_, week) => {
                    const weekStart = new Date(month.getFullYear(), month.getMonth(), 1 - blanks + week * 7);
                    const monthEnd = addMonths(month, 1);
                    const bars = weekBars(orders, weekStart, month, monthEnd);
                    const lanes = Math.min(MAX_LANES, bars.reduce((most, bar) => Math.max(most, bar.lane + 1), 0));
                    const hidden = bars.filter((bar) => bar.lane >= MAX_LANES).length;
                    return (
                      <div
                        key={week}
                        className="relative grid grid-cols-7 border-t border-[rgba(17,19,24,0.06)]"
                        style={{ minHeight: 18 + Math.max(lanes, 1) * LANE_HEIGHT + (hidden ? 10 : 2) }}
                      >
                        {Array.from({ length: 7 }, (_, column) => {
                          const day = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + column);
                          const inMonth = day.getMonth() === month.getMonth();
                          const isToday = isSameDay(day, today);
                          const weekend = [0, 6].includes(day.getDay());
                          return (
                            <span
                              key={column}
                              className={cn(
                                "border-l border-[rgba(17,19,24,0.04)] px-0.5 pt-0.5 text-left text-[10px] leading-none first:border-l-0",
                                inMonth && weekend ? "bg-[#faf4eb]" : "",
                                isToday ? "bg-[var(--brand-soft)]" : "",
                              )}
                            >
                              {inMonth ? (
                                <span
                                  className={cn(
                                    "tabular-nums",
                                    isToday ? "font-bold text-[var(--accent)]" : "text-[color:var(--ink-soft)]",
                                  )}
                                >
                                  {day.getDate()}
                                </span>
                              ) : null}
                            </span>
                          );
                        })}
                        {bars
                          .filter((bar) => bar.lane < MAX_LANES)
                          .map((bar) => (
                            <button
                              key={bar.order.id}
                              type="button"
                              onClick={() => onSelectOrder(bar.order)}
                              title={`${bar.order.renterName} · ${getStatusLabel(bar.order.status, locale)}`}
                              className={cn(
                                "tap-compact absolute flex items-center overflow-hidden border px-1 text-left text-[9px] font-semibold leading-none shadow-[0_6px_14px_-8px_rgba(17,19,24,0.6)] transition hover:brightness-110",
                                barColour(bar.order),
                                bar.clippedStart ? "rounded-l-none border-l-0" : "rounded-l-[4px]",
                                bar.clippedEnd ? "rounded-r-none border-r-0" : "rounded-r-[4px]",
                              )}
                              style={{
                                left: `${bar.left * 100}%`,
                                width: `${bar.width * 100}%`,
                                top: 15 + bar.lane * LANE_HEIGHT,
                                height: LANE_HEIGHT - 2,
                              }}
                            >
                              <span className="truncate">{bar.order.renterName}</span>
                            </button>
                          ))}
                        {hidden ? (
                          <span
                            className="absolute right-1 text-[8px] font-bold text-[#c61e22]"
                            style={{ top: 15 + MAX_LANES * LANE_HEIGHT - 1 }}
                          >
                            +{hidden}
                          </span>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>

          <div className="flex justify-center">
            <button
              type="button"
              onClick={() =>
                setRange((current) => ({ ...current, forward: current.forward + MONTH_STEP }))
              }
              disabled={months.length >= MAX_MONTHS}
              className="mt-3 rounded-md border border-[var(--line)] bg-white px-3 py-1 text-[11px] font-semibold text-[color:var(--ink-soft)] transition hover:text-[var(--ink)] disabled:opacity-40"
            >
              {months.length >= MAX_MONTHS ? messages.monthMaxReached : messages.monthLater}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
