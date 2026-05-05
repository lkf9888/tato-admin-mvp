import Link from "next/link";

import { StatusBadge } from "@/components/status-badge";
import { type Locale } from "@/lib/i18n";
import { formatDateTime } from "@/lib/utils";

/**
 * Mobile-only replacement for the calendar timeline. The desktop
 * `CalendarView` is a 1400-line 2D grid that needs both vertical and
 * horizontal scrolling to be useful — that pattern doesn't translate
 * to a 375px-wide viewport. Phones get a vertical, time-grouped list
 * instead, modeled on iOS Calendar's Day view: each upcoming booking
 * is one row with vehicle / renter / time / status.
 *
 * Server-rendered, no JS — the page already has the orders data, so
 * we just bucket and render. Tapping a row sends the user to /orders
 * (the shared list view) for editing; if a row-level detail view is
 * added later we can swap the destination here.
 */

export type ScheduleOrder = {
  id: string;
  vehicleName: string;
  vehiclePlateNumber: string;
  renterName: string;
  ownerName?: string | null;
  pickupDatetime: Date;
  returnDatetime: Date;
  status: string;
  source: string;
  hasConflict: boolean;
};

type Bucket = {
  key: "today" | "tomorrow" | "thisWeek" | "later";
  label: string;
  orders: ScheduleOrder[];
};

function bucketOrders(orders: ScheduleOrder[], labels: ScheduleListLabels): Bucket[] {
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfTomorrow = new Date(startOfToday);
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
  const startOfDayAfterTomorrow = new Date(startOfTomorrow);
  startOfDayAfterTomorrow.setDate(startOfDayAfterTomorrow.getDate() + 1);
  const startOfWeekFromNow = new Date(startOfToday);
  startOfWeekFromNow.setDate(startOfWeekFromNow.getDate() + 7);

  const today: ScheduleOrder[] = [];
  const tomorrow: ScheduleOrder[] = [];
  const thisWeek: ScheduleOrder[] = [];
  const later: ScheduleOrder[] = [];

  for (const order of orders) {
    // We treat "today" as anything overlapping today's wall clock —
    // ongoing trips that started yesterday but haven't returned yet
    // should still surface at the top of the list. Otherwise a host
    // who opens the app at noon would see no entry for the renter
    // currently driving their car, which is the exact opposite of
    // what a schedule view should do.
    const overlapsToday =
      order.pickupDatetime <= startOfTomorrow &&
      order.returnDatetime >= startOfToday;

    if (overlapsToday) {
      today.push(order);
      continue;
    }

    if (order.pickupDatetime < startOfDayAfterTomorrow) {
      tomorrow.push(order);
      continue;
    }

    if (order.pickupDatetime < startOfWeekFromNow) {
      thisWeek.push(order);
      continue;
    }

    // Skip far-future bookings on this view — they're available on
    // /orders. Showing them here would dilute the "what do I need to
    // care about" framing of the page. We still include them under
    // "later" so the host can scroll if they want; the assumption is
    // that an active fleet rarely has bookings more than ~30 days out.
    later.push(order);
  }

  // Each bucket is sorted by pickup time. The bucketing above already
  // preserves the input order (we walk in chronological order from
  // the page), but be explicit so the contract is local to this file.
  const byPickup = (a: ScheduleOrder, b: ScheduleOrder) =>
    a.pickupDatetime.getTime() - b.pickupDatetime.getTime();

  return [
    { key: "today", label: labels.today, orders: today.sort(byPickup) },
    { key: "tomorrow", label: labels.tomorrow, orders: tomorrow.sort(byPickup) },
    { key: "thisWeek", label: labels.thisWeek, orders: thisWeek.sort(byPickup) },
    { key: "later", label: labels.later, orders: later.sort(byPickup) },
  ];
}

export type ScheduleListLabels = {
  title: string;
  subtitle: string;
  emptyAll: string;
  today: string;
  tomorrow: string;
  thisWeek: string;
  later: string;
  noneInBucket: string;
};

export function MobileScheduleList({
  orders,
  locale,
  labels,
  className,
}: {
  orders: ScheduleOrder[];
  locale: Locale;
  labels: ScheduleListLabels;
  className?: string;
}) {
  const buckets = bucketOrders(orders, labels);
  const totalUpcoming = buckets.reduce((sum, b) => sum + b.orders.length, 0);

  return (
    <section className={className}>
      <header className="mb-3">
        <p className="text-[9px] uppercase tracking-[0.24em] text-[var(--ink-soft)]">
          {labels.subtitle}
        </p>
        <h2 className="mt-0.5 font-serif text-[1.1rem] font-semibold leading-tight text-[var(--ink)]">
          {labels.title}
        </h2>
      </header>

      {totalUpcoming === 0 ? (
        <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-4 py-5 text-center text-[12px] text-[var(--ink-soft)]">
          {labels.emptyAll}
        </div>
      ) : (
        <div className="space-y-5">
          {buckets.map((bucket) => {
            // Skip empty buckets entirely except for Today — Today
            // always renders so the user immediately sees "nothing on
            // your plate this morning" instead of having to mentally
            // scan past a bunch of future blocks.
            if (bucket.orders.length === 0 && bucket.key !== "today") {
              return null;
            }

            return (
              <div key={bucket.key}>
                <div className="mb-2 flex items-baseline justify-between">
                  <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--ink-soft)]">
                    {bucket.label}
                  </h3>
                  <span className="text-[11px] text-[var(--ink-soft)]/70">
                    {bucket.orders.length}
                  </span>
                </div>

                {bucket.orders.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-[var(--line)] px-4 py-5 text-center text-[12px] text-[var(--ink-soft)]/80">
                    {labels.noneInBucket}
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {bucket.orders.map((order) => (
                      <li key={order.id}>
                        <Link
                          href="/orders"
                          className="tap-press block rounded-lg border border-[var(--line)] bg-[var(--surface)] px-4 py-3 hover:border-[rgba(17,19,24,0.18)]"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-[15px] font-semibold text-[var(--ink)]">
                                {order.vehicleName} · {order.renterName}
                              </p>
                              <p className="mt-1 text-[12px] leading-snug text-[var(--ink-soft)]">
                                {formatDateTime(order.pickupDatetime, locale)} —{" "}
                                {formatDateTime(order.returnDatetime, locale)}
                              </p>
                              {order.vehiclePlateNumber || order.ownerName ? (
                                <p className="mt-1 truncate text-[11px] text-[var(--ink-soft)]/80">
                                  {[order.vehiclePlateNumber, order.ownerName]
                                    .filter(Boolean)
                                    .join(" · ")}
                                </p>
                              ) : null}
                            </div>
                            <div className="flex shrink-0 flex-col items-end gap-1">
                              <StatusBadge value={order.status} locale={locale} />
                              {order.hasConflict ? (
                                <StatusBadge value="conflict" locale={locale} />
                              ) : null}
                            </div>
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
