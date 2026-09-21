"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { type EditableOrder } from "@/components/order-detail-modal";
import { getMessages, getStatusLabel, type Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

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

const DAY_IN_MS = 24 * 60 * 60 * 1000;
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

function barColour(order: MonthOrder) {
  if (order.hasConflict) return "border-[#c61e22] bg-[#e5484d] text-white";
  if (order.status === "cancelled") {
    return "border-dashed border-[rgba(17,19,24,0.3)] bg-[rgba(17,19,24,0.1)] text-[color:var(--ink-soft)] line-through";
  }
  if (order.ownerId && order.ownerLedgerSyncedAt) {
    return "border-[#1f5b48] bg-[#2f7f67] text-white";
  }
  if (order.source === "turo") return "border-[#1f3aa8] bg-[#3456df] text-white";
  return "border-[#1f5b48] bg-[#2f7f67] text-white";
}

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
          `/api/calendar/orders?from=${from.toISOString().slice(0, 10)}&to=${to
            .toISOString()
            .slice(0, 10)}`,
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

  /** The trips touching one day, for the cell that draws them. */
  const ordersOnDay = (day: Date) => {
    const start = day.getTime();
    const end = start + DAY_IN_MS;
    return orders.filter(
      (order) =>
        new Date(order.pickupDatetime).getTime() < end &&
        new Date(order.returnDatetime).getTime() > start,
    );
  };

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
                  <div className="grid grid-cols-7 gap-px text-center">
                    {weekdayHeaders.map((label) => (
                      <span
                        key={label}
                        className="pb-1 text-[9px] uppercase tracking-wide text-[color:var(--ink-soft)]"
                      >
                        {label}
                      </span>
                    ))}
                    {Array.from({ length: blanks }, (_, index) => (
                      <span key={`blank-${index}`} />
                    ))}
                    {Array.from({ length: daysInMonth }, (_, index) => {
                      const day = new Date(month.getFullYear(), month.getMonth(), index + 1);
                      const dayOrders = ordersOnDay(day);
                      const weekend = [0, 6].includes(day.getDay());
                      const isToday = isSameDay(day, today);
                      const live = dayOrders.filter((order) => order.status !== "cancelled");
                      const primary = live[0] ?? dayOrders[0];

                      return (
                        <button
                          key={day.toISOString()}
                          type="button"
                          disabled={!primary}
                          onClick={() => primary && onSelectOrder(primary)}
                          title={
                            primary
                              ? `${primary.renterName} · ${getStatusLabel(primary.status, locale)}`
                              : undefined
                          }
                          className={cn(
                            "flex aspect-square flex-col items-center justify-start gap-0.5 rounded-[3px] border p-0.5 text-[10px] leading-none transition",
                            weekend ? "bg-[#faf4eb]" : "bg-white",
                            isToday
                              ? "border-[var(--accent)] ring-1 ring-[var(--accent)]"
                              : "border-[rgba(17,19,24,0.06)]",
                            primary ? "cursor-pointer hover:brightness-95" : "cursor-default",
                          )}
                        >
                          <span
                            className={cn(
                              "tabular-nums",
                              isToday
                                ? "font-bold text-[var(--accent)]"
                                : "text-[color:var(--ink-soft)]",
                            )}
                          >
                            {index + 1}
                          </span>
                          {primary ? (
                            <span
                              className={cn(
                                "w-full truncate rounded-[2px] border px-0.5 text-[8px] leading-[11px]",
                                barColour(primary),
                              )}
                            >
                              {primary.renterName}
                            </span>
                          ) : null}
                          {live.length > 1 ? (
                            <span className="text-[8px] font-bold text-[#c61e22]">
                              +{live.length - 1}
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
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
