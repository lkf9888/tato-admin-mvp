"use client";

import { ChevronDown } from "lucide-react";
import { useMemo, useState } from "react";

import { CalendarOrderSheet } from "@/components/calendar-order-sheet";
import { CalendarViewToggle, useCalendarViewMode } from "@/components/mobile-calendar-switch";
import { MobilePageHeader } from "@/components/mobile-chrome";
import {
  type EditableOrder,
  OrderDetailModal,
  type OrderEditorVehicleOption,
} from "@/components/order-detail-modal";
import { getLocaleTag, getMessages, type Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export type AgendaOrder = {
  order: EditableOrder;
  /** Who does each handover, from the staff schedule; null when nobody. */
  pickupStaff: string | null;
  returnStaff: string | null;
};

const DAYS_SHOWN = 7;

const startOfDay = (date: Date) => {
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  return day;
};
const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};
const inDay = (iso: string, day: Date) => {
  const time = new Date(iso).getTime();
  return time >= day.getTime() && time < addDays(day, 1).getTime();
};
const hhmm = (iso: string) => {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
};

/**
 * The calendar as a list, on a phone: one day at a time, chosen from a
 * strip of the next seven with how many handovers each holds. The day
 * is its pickups, then its returns, each a 58px row -- the time, the
 * car and guest, the plate, place and who does it, and whether anyone
 * is assigned. Trips running through the day with no handover in it
 * are one folded row: they need nothing today.
 *
 * Built in the browser so "today" is the phone's today. A row opens the
 * same card as a bar on the timeline.
 */
export function CalendarAgendaList({
  orders,
  locale,
  vehicleOptions,
  readOnly,
}: {
  orders: AgendaOrder[];
  locale: Locale;
  vehicleOptions: OrderEditorVehicleOption[];
  readOnly?: boolean;
}) {
  const messages = getMessages(locale).calendar.mobile;
  const t = messages.list;
  const today = useMemo(() => startOfDay(new Date()), []);
  const days = useMemo(() => Array.from({ length: DAYS_SHOWN }, (_, index) => addDays(today, index)), [today]);
  const [dayIndex, setDayIndex] = useState(0);
  const [ongoingOpen, setOngoingOpen] = useState(false);
  const [sheetOrder, setSheetOrder] = useState<EditableOrder | null>(null);
  const [modalOrder, setModalOrder] = useState<EditableOrder | null>(null);
  const mode = useCalendarViewMode();

  const live = orders.filter((item) => item.order.status !== "cancelled");
  const handoversOn = (day: Date) =>
    live.filter((item) => inDay(item.order.pickupDatetime, day) || inDay(item.order.returnDatetime, day)).length;

  const dayLabel = (day: Date, index: number) => {
    if (index === 0) return messages.today;
    if (index === 1) return messages.tomorrow;
    return new Intl.DateTimeFormat(getLocaleTag(locale), { weekday: "short" }).format(day);
  };
  const day = days[dayIndex];
  const label = dayLabel(day, dayIndex);
  const now = Date.now();

  const pickups = live
    .filter((item) => inDay(item.order.pickupDatetime, day))
    .sort((a, b) => a.order.pickupDatetime.localeCompare(b.order.pickupDatetime));
  const returns = live
    .filter((item) => inDay(item.order.returnDatetime, day))
    .sort((a, b) => a.order.returnDatetime.localeCompare(b.order.returnDatetime));
  const ongoing = live.filter(
    (item) =>
      new Date(item.order.pickupDatetime) < day &&
      new Date(item.order.returnDatetime) >= addDays(day, 1),
  );

  const title = new Intl.DateTimeFormat(getLocaleTag(locale), {
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(day);

  const row = (item: AgendaOrder, kind: "pickup" | "return") => {
    const at = kind === "pickup" ? item.order.pickupDatetime : item.order.returnDatetime;
    const staff = kind === "pickup" ? item.pickupStaff : item.returnStaff;
    // The exact spot when someone has recorded it, else the place.
    const place =
      kind === "pickup"
        ? item.order.pickupSpot || item.order.pickupLocation
        : item.order.returnSpot || item.order.returnLocation || item.order.pickupLocation;
    const done = new Date(at).getTime() < now;
    const chip =
      kind === "return" && done
        ? { label: t.returned, tone: "bg-[var(--surface-muted)] text-[var(--ink-soft)]" }
        : staff
          ? { label: t.assigned, tone: "bg-emerald-100 text-emerald-800" }
          : { label: t.unassigned, tone: "bg-amber-100 text-amber-800" };
    return (
      <li key={`${kind}:${item.order.id}`}>
        <button
          type="button"
          onClick={() => setSheetOrder(item.order)}
          className={cn(
            "tap-compact flex h-[58px] w-full items-center gap-3 border-b border-[var(--line)] bg-[var(--surface)] px-3.5 text-left",
            done && "opacity-55",
          )}
        >
          <span className="flex w-11 shrink-0 flex-col leading-[1.2]">
            <span className="text-[14px] font-semibold tabular-nums text-[var(--ink)]">{hhmm(at)}</span>
            <span
              className={cn(
                "text-[10.5px] font-semibold",
                kind === "pickup" ? "text-[var(--brand)]" : "text-[#c25e00]",
              )}
            >
              {kind === "pickup" ? t.pickup : t.return}
            </span>
          </span>
          <span className="min-w-0 flex-1 leading-[1.3]">
            <span className="block truncate text-[14px] font-semibold text-[var(--ink)]">
              {item.order.vehicleName} · {item.order.renterName}
            </span>
            <span className="block truncate text-[12px] text-[var(--ink-soft)]">
              {[item.order.vehiclePlateNumber, place, staff].filter(Boolean).join(" · ")}
            </span>
          </span>
          <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10.5px] font-semibold", chip.tone)}>
            {chip.label}
          </span>
        </button>
      </li>
    );
  };

  const section = (heading: string, items: AgendaOrder[], kind: "pickup" | "return") =>
    items.length > 0 ? (
      <section>
        <h3 className="flex items-center justify-between bg-[var(--surface-muted)] px-3.5 pb-1.5 pt-3 text-[12px] font-semibold text-[var(--ink-mid)]">
          <span>{heading}</span>
          <span className="font-normal text-[var(--ink-soft)]">{items.length}</span>
        </h3>
        <ul>{items.map((item) => row(item, kind))}</ul>
      </section>
    ) : null;

  return (
    <div className="-mx-2.5 -mt-3 bg-[var(--surface-muted)]">
      {mode === "list" ? (
        <MobilePageHeader
          title={<span className="truncate text-[17px] font-semibold leading-tight text-[var(--ink)]">{title}</span>}
        />
      ) : null}
      <div className="flex h-10 items-center justify-between gap-2 border-b border-[var(--line)] bg-[var(--surface)] px-2.5">
        <div className="flex min-w-0 gap-1.5 overflow-x-auto [scrollbar-width:none]">
          {days.map((date, index) => {
            const count = handoversOn(date);
            const on = index === dayIndex;
            return (
              <button
                key={date.toISOString()}
                type="button"
                onClick={() => setDayIndex(index)}
                aria-pressed={on}
                className={cn(
                  "tap-compact hit-area h-7 shrink-0 whitespace-nowrap rounded-full border px-2.5 text-[12px] font-semibold",
                  on
                    ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--surface)]"
                    : "border-[var(--line-strong)] bg-[var(--surface)] text-[var(--ink)]",
                )}
              >
                {dayLabel(date, index)}
                {count ? <span className="font-normal opacity-75"> {count}</span> : null}
              </button>
            );
          })}
        </div>
        <CalendarViewToggle />
      </div>

      {pickups.length === 0 && returns.length === 0 ? (
        <p className="bg-[var(--surface)] px-3.5 py-6 text-center text-[13px] text-[var(--ink-soft)]">{t.nothing}</p>
      ) : null}
      {section(t.pickups(label), pickups, "pickup")}
      {section(t.returns(label), returns, "return")}

      {ongoing.length > 0 ? (
        <section className="mt-2">
          <button
            type="button"
            onClick={() => setOngoingOpen((open) => !open)}
            aria-expanded={ongoingOpen}
            className="tap-compact flex h-[46px] w-full items-center justify-between border-b border-[var(--line)] bg-[var(--surface)] px-3.5 text-left text-[13px] text-[var(--ink)]"
          >
            <span>
              <b>{t.ongoing}</b> <span className="text-[var(--ink-soft)]">· {t.ongoingSummary(ongoing.length)}</span>
            </span>
            <ChevronDown
              className={cn("h-4 w-4 text-[var(--ink-soft)] transition", ongoingOpen && "rotate-180")}
              aria-hidden
            />
          </button>
          {ongoingOpen ? (
            <ul>
              {ongoing.map((item) => (
                <li key={item.order.id}>
                  <button
                    type="button"
                    onClick={() => setSheetOrder(item.order)}
                    className="tap-compact flex h-[52px] w-full items-center gap-3 border-b border-[var(--line)] bg-[var(--surface)] px-3.5 text-left"
                  >
                    <span className="min-w-0 flex-1 leading-[1.3]">
                      <span className="block truncate text-[14px] font-semibold text-[var(--ink)]">
                        {item.order.vehicleName} · {item.order.renterName}
                      </span>
                      <span className="block truncate text-[12px] text-[var(--ink-soft)]">
                        {[item.order.vehiclePlateNumber, `→ ${new Date(item.order.returnDatetime).toLocaleDateString(getLocaleTag(locale), { month: "numeric", day: "numeric" })} ${hhmm(item.order.returnDatetime)}`]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {sheetOrder ? (
        <CalendarOrderSheet
          order={sheetOrder}
          locale={locale}
          readOnly={readOnly}
          onClose={() => setSheetOrder(null)}
          onOpenOrder={() => {
            setModalOrder(sheetOrder);
            setSheetOrder(null);
          }}
        />
      ) : null}
      {modalOrder ? (
        <OrderDetailModal
          order={modalOrder}
          vehicleOptions={vehicleOptions}
          locale={locale}
          readOnly={readOnly}
          onClose={() => setModalOrder(null)}
          onSaved={(updated) => setModalOrder(updated)}
          onDeleted={() => setModalOrder(null)}
        />
      ) : null}
    </div>
  );
}
