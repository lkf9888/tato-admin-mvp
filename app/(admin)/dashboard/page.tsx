import Link from "next/link";

import { prisma } from "@/lib/prisma";
import { MetricCard } from "@/components/metric-card";
import {
  cn,
  formatCurrency,
  formatDateTime,
  formatNumber,
  formatPercentage,
  getOrderNetEarning,
} from "@/lib/utils";
import { StatusBadge } from "@/components/status-badge";
import { requireCurrentWorkspace } from "@/lib/auth";
import { getActivityActionLabel, getLocaleTag, type Locale } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n-server";

/**
 * Strip the rendered datetime down to "10:30 AM" / "10:30" — when
 * the panel header already says "Today" or "Tomorrow", showing the
 * full date next to every event is noise. Falls back to the locale-
 * appropriate hour:minute pattern.
 */
function formatTimeOnly(date: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(getLocaleTag(locale), {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/**
 * One pickup OR one return event derived from an Order. An order with
 * pickup AND return on the same day produces TWO events (one of each
 * kind), which is the right behavior — they're independent operational
 * actions the team needs to handle.
 */
type DayOrder = Awaited<ReturnType<typeof fetchDayOrders>>[number];
type DayEvent = {
  kind: "pickup" | "return";
  time: Date;
  location: string | null;
  order: DayOrder;
};

async function fetchDayOrders(workspaceId: string, dayStart: Date, dayEnd: Date) {
  return prisma.order.findMany({
    where: {
      workspaceId,
      isArchived: false,
      status: { not: "cancelled" },
      // Top-level fields combine via AND, the OR captures "either pickup
      // OR return falls inside the day window" — which is what we want
      // for an operational hot list.
      OR: [
        { pickupDatetime: { gte: dayStart, lte: dayEnd } },
        { returnDatetime: { gte: dayStart, lte: dayEnd } },
      ],
    },
    include: { vehicle: true },
    orderBy: { pickupDatetime: "asc" },
  });
}

function buildDayEvents(orders: DayOrder[], dayStart: Date, dayEnd: Date): DayEvent[] {
  const events: DayEvent[] = [];
  for (const order of orders) {
    if (order.pickupDatetime >= dayStart && order.pickupDatetime <= dayEnd) {
      events.push({
        kind: "pickup",
        time: order.pickupDatetime,
        location: order.pickupLocation,
        order,
      });
    }
    if (order.returnDatetime >= dayStart && order.returnDatetime <= dayEnd) {
      events.push({
        kind: "return",
        time: order.returnDatetime,
        location: order.returnLocation,
        order,
      });
    }
  }
  return events.sort((a, b) => a.time.getTime() - b.time.getTime());
}

export default async function DashboardPage() {
  const workspace = await requireCurrentWorkspace();
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);

  // Tomorrow boundaries computed off startOfDay so DST shifts don't
  // skew the math (adding 24h is wrong twice a year; setDate +1 keeps
  // the wall-clock anchor and lets the JS Date handle DST transparently).
  const startOfTomorrow = new Date(startOfDay);
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
  const endOfTomorrow = new Date(endOfDay);
  endOfTomorrow.setDate(endOfTomorrow.getDate() + 1);

  // Month boundaries for the new "This month" overview. We pull both
  // the current month and last month in a single query (one round
  // trip), then bucket in JS — Prisma doesn't ship `GROUP BY month`
  // on SQLite without raw SQL, and the order count for any single
  // workspace's two months stays in the low hundreds in practice.
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

  const [
    { locale, messages },
    todayOrders,
    todayDayOrders,
    tomorrowDayOrders,
    conflictOrders,
    latestImport,
    latestLogs,
    monthlyOrders,
  ] = await Promise.all([
    getI18n(),
    prisma.order.findMany({
      where: {
        workspaceId: workspace.id,
        isArchived: false,
        pickupDatetime: { lte: endOfDay },
        returnDatetime: { gte: startOfDay },
        status: { not: "cancelled" },
      },
      include: { vehicle: true },
      orderBy: { pickupDatetime: "asc" },
    }),
    fetchDayOrders(workspace.id, startOfDay, endOfDay),
    fetchDayOrders(workspace.id, startOfTomorrow, endOfTomorrow),
    prisma.order.findMany({
      where: { workspaceId: workspace.id, isArchived: false, hasConflict: true },
      include: { vehicle: true },
      orderBy: { pickupDatetime: "asc" },
    }),
    prisma.importBatch.findFirst({
      where: { workspaceId: workspace.id },
      orderBy: { importedAt: "desc" },
    }),
    prisma.activityLog.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { createdAt: "desc" },
      take: 6,
    }),
    prisma.order.findMany({
      where: {
        workspaceId: workspace.id,
        isArchived: false,
        status: { not: "cancelled" },
        pickupDatetime: { gte: lastMonthStart, lt: nextMonthStart },
      },
      select: {
        vehicleId: true,
        pickupDatetime: true,
        totalPrice: true,
        sourceMetadata: true,
      },
    }),
  ]);
  const dashboardMessages = messages.dashboard;
  const monthlyMessages = dashboardMessages.monthly;
  const eventMessages = dashboardMessages.event;

  const todayEvents = buildDayEvents(todayDayOrders, startOfDay, endOfDay);
  const tomorrowEvents = buildDayEvents(tomorrowDayOrders, startOfTomorrow, endOfTomorrow);

  const todaysRentals = todayOrders.length;
  const todaysPickups = todayOrders.filter((order) => order.pickupDatetime >= startOfDay).length;
  const todaysReturns = todayOrders.filter((order) => order.returnDatetime <= endOfDay).length;

  // Monthly KPI math. Bucket the joined month-window query into
  // current vs previous; sum net earnings, count trips, count
  // distinct vehicles touched.
  const currentMonthOrders = monthlyOrders.filter(
    (order) => order.pickupDatetime >= currentMonthStart,
  );
  const lastMonthOrders = monthlyOrders.filter(
    (order) =>
      order.pickupDatetime >= lastMonthStart && order.pickupDatetime < currentMonthStart,
  );
  const sumNetEarnings = (rows: typeof monthlyOrders) =>
    rows.reduce(
      (sum, order) => sum + (getOrderNetEarning(order.sourceMetadata, order.totalPrice) ?? 0),
      0,
    );
  const currentMonthNet = sumNetEarnings(currentMonthOrders);
  const lastMonthNet = sumNetEarnings(lastMonthOrders);
  const currentMonthTripCount = currentMonthOrders.length;
  const activeVehicleCount = new Set(currentMonthOrders.map((order) => order.vehicleId)).size;
  const avgPerTrip = currentMonthTripCount > 0 ? currentMonthNet / currentMonthTripCount : null;

  // Delta: undefined when there's no last-month baseline (avoids
  // divide-by-zero and the misleading "+infinity %" we'd otherwise
  // show on a workspace's first full month).
  let deltaPctValue: number | null = null;
  if (lastMonthNet > 0) {
    deltaPctValue = ((currentMonthNet - lastMonthNet) / lastMonthNet) * 100;
  } else if (currentMonthNet > 0 && lastMonthNet === 0) {
    // Brand-new revenue this month with nothing to compare against.
    // Showing the raw delta as "+∞%" is hostile; we surface the
    // "no baseline" copy instead.
    deltaPctValue = null;
  }

  // Localized month label (e.g. "April 2026" / "2026年4月") for the
  // section title — gives the KPI strip a visible time anchor.
  const monthLabel = new Intl.DateTimeFormat(getLocaleTag(locale), {
    month: "long",
    year: "numeric",
  }).format(currentMonthStart);

  let deltaHint: string;
  if (deltaPctValue == null) {
    deltaHint = monthlyMessages.deltaNoBaseline;
  } else if (deltaPctValue > 0.05) {
    deltaHint = monthlyMessages.deltaUp(formatPercentage(deltaPctValue, locale, 1));
  } else if (deltaPctValue < -0.05) {
    deltaHint = monthlyMessages.deltaDown(formatPercentage(Math.abs(deltaPctValue), locale, 1));
  } else {
    deltaHint = monthlyMessages.deltaFlat;
  }

  // Compose the "Net earnings (MTD)" hint with both the delta and
  // the absolute last-month value, so the operator has the full
  // comparison in one glance without leaving the card.
  const netHint =
    lastMonthNet > 0
      ? `${deltaHint} · ${monthlyMessages.lastMonthAmount(formatCurrency(lastMonthNet, locale))}`
      : deltaHint;

  // Pickup/return event row used by both Today and Tomorrow panels.
  // Renders as a tappable list cell — the entire row is a Link to
  // /orders so finger-anywhere navigation works the same as the iOS
  // list-cell pattern used elsewhere in the dashboard.
  //
  // v0.20.2 density pass: padding tightened (px-3 py-2 vs px-4 py-3),
  // text reflowed (vehicle line at 13px mobile, location at 11px) so
  // a typical 5-event day fits without pushing the panel below the
  // fold on a 1080p laptop.
  const renderEvent = (event: DayEvent) => {
    const isPickup = event.kind === "pickup";
    const locationPrefix = isPickup
      ? eventMessages.pickupLocationPrefix
      : eventMessages.returnLocationPrefix;
    const locationValue = event.location?.trim() || eventMessages.noLocation;
    const order = event.order;

    return (
      <Link
        key={`${order.id}-${event.kind}`}
        href="/orders"
        className="tap-press flex flex-col gap-1.5 rounded-lg border border-slate-200 px-3 py-2 hover:border-slate-300 hover:bg-slate-50/50 sm:flex-row sm:items-start sm:justify-between sm:gap-2.5 sm:px-3.5 sm:py-2.5"
      >
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <span
              className={cn(
                "inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em]",
                isPickup
                  ? "bg-[var(--accent-soft)] text-[var(--ink)]"
                  : "bg-slate-900 text-white",
              )}
            >
              {isPickup ? eventMessages.pickupBadge : eventMessages.returnBadge}
            </span>
            <span className="text-[12px] font-semibold tabular-nums text-slate-900 sm:text-[13px]">
              {formatTimeOnly(event.time, locale)}
            </span>
          </div>
          <p className="mt-0.5 truncate text-[13px] font-semibold text-slate-900 sm:text-[13.5px]">
            {order.vehicle.plateNumber
              ? `${order.vehicle.plateNumber} · ${order.vehicle.nickname}`
              : order.vehicle.nickname}
            {" · "}
            {order.renterName}
          </p>
          <p className="mt-0.5 text-[11px] leading-snug text-slate-500 sm:text-[12px]">
            <span className="text-slate-400">{locationPrefix}:</span>{" "}
            <span className="text-slate-700">{locationValue}</span>
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1 sm:flex-nowrap sm:gap-1.5">
          <StatusBadge value={order.source} locale={locale} />
          <StatusBadge value={order.status} locale={locale} />
          {order.hasConflict ? <StatusBadge value="conflict" locale={locale} /> : null}
        </div>
      </Link>
    );
  };

  // Compact panel link (e.g. "Open orders →") shared by Today /
  // Tomorrow / Activity headers. Density pass shrank padding from
  // `px-3 py-1.5` to `px-2.5 py-1` and the text from `text-xs` to
  // `text-[11px]` so the link doesn't dominate the card header.
  const panelLinkClass =
    "tap-press inline-flex w-fit items-center gap-1 self-start rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 sm:self-auto";

  const renderDayPanel = (
    kicker: string,
    title: string,
    events: DayEvent[],
    emptyMessage: string,
  ) => (
    <div className="rounded-lg border border-white/70 bg-white/90 p-3 shadow-sm sm:p-4">
      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <div className="min-w-0">
          <p className="text-[9px] uppercase tracking-[0.22em] text-slate-500 sm:text-[10px] sm:tracking-[0.24em]">
            {kicker}
          </p>
          <h3 className="mt-0.5 font-serif text-[0.95rem] font-semibold leading-tight text-slate-950 sm:text-[1.15rem]">
            {title}
          </h3>
        </div>
        <Link href="/orders" className={panelLinkClass}>
          {dashboardMessages.openOrders}
          <span aria-hidden>→</span>
        </Link>
      </div>

      <div className="mt-2 space-y-1.5 sm:mt-2.5">
        {events.length === 0 ? (
          <p className="rounded-lg bg-slate-50 px-3 py-3.5 text-center text-[12px] text-slate-500">
            {emptyMessage}
          </p>
        ) : (
          events.map(renderEvent)
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-3 sm:space-y-3.5 lg:space-y-3">
      {/*
       * Daily-snapshot strip. On phones the five cards are hot in a horizontal
       * snap-scroll row — same pattern App Store / Apple Wallet use for
       * widget rows. The negative horizontal margin (-mx-3) lets the
       * row bleed all the way to the screen edge so the right-most
       * card hints "swipe me" without pretending the page has more
       * margin than it does. On `sm:` and up we revert to the original
       * static grid.
       *
       * v0.20.2: card width dropped from 58% to 52% so a sliver of the
       * second card is visible at rest (the swipe affordance is
       * stronger), and the desktop grid gap tightened from gap-4 to
       * gap-3 to match the rest of the page's density.
       */}
      <section className="-mx-3 overflow-x-auto px-3 pb-1 sm:mx-0 sm:px-0 sm:pb-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex snap-x snap-mandatory gap-3 sm:grid sm:grid-cols-2 sm:gap-3 xl:grid-cols-5">
          <div className="w-[52%] shrink-0 sm:w-auto">
            <MetricCard
              label={dashboardMessages.metrics.inUseLabel}
              value={String(todaysRentals)}
              hint={dashboardMessages.metrics.inUseHint}
            />
          </div>
          <div className="w-[52%] shrink-0 sm:w-auto">
            <MetricCard
              label={dashboardMessages.metrics.pickupsLabel}
              value={String(todaysPickups)}
              hint={dashboardMessages.metrics.pickupsHint}
            />
          </div>
          <div className="w-[52%] shrink-0 sm:w-auto">
            <MetricCard
              label={dashboardMessages.metrics.returnsLabel}
              value={String(todaysReturns)}
              hint={dashboardMessages.metrics.returnsHint}
            />
          </div>
          <div className="w-[52%] shrink-0 sm:w-auto">
            <MetricCard
              label={dashboardMessages.metrics.conflictsLabel}
              value={String(conflictOrders.length)}
              hint={dashboardMessages.metrics.conflictsHint}
            />
          </div>
          <div className="w-[52%] shrink-0 sm:w-auto">
            <MetricCard
              label={dashboardMessages.metrics.lastSyncLabel}
              value={
                latestImport
                  ? formatDateTime(latestImport.importedAt, locale)
                  : dashboardMessages.metrics.never
              }
              hint={dashboardMessages.metrics.lastSyncHint}
            />
          </div>
        </div>
      </section>

      {/*
       * Monthly KPI strip. Lives below the daily snapshot because
       * "what happened today?" is the single most-checked stat; the
       * monthly numbers are second-tier glanceability. Same
       * snap-scroll pattern on mobile, 4-col grid on desktop.
       */}
      <section className="space-y-1.5">
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
          <p className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-soft)] sm:text-[10px] sm:tracking-[0.26em]">
            {dashboardMessages.monthlyKicker}
          </p>
          <p className="text-[10px] text-[color:var(--ink-soft)] sm:text-[11px]">{monthlyMessages.title(monthLabel)}</p>
        </div>
        <div className="-mx-3 overflow-x-auto px-3 pb-1 sm:mx-0 sm:px-0 sm:pb-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="flex snap-x snap-mandatory gap-3 sm:grid sm:grid-cols-2 sm:gap-3 xl:grid-cols-4">
            <div className="w-[52%] shrink-0 sm:w-auto">
              <MetricCard
                label={monthlyMessages.netLabel}
                value={formatCurrency(currentMonthNet, locale)}
                hint={netHint}
              />
            </div>
            <div className="w-[52%] shrink-0 sm:w-auto">
              <MetricCard
                label={monthlyMessages.tripsLabel}
                value={formatNumber(currentMonthTripCount, locale, 0)}
                hint={
                  currentMonthTripCount === 0
                    ? monthlyMessages.emptyMonth
                    : monthlyMessages.tripsHint
                }
              />
            </div>
            <div className="w-[52%] shrink-0 sm:w-auto">
              <MetricCard
                label={monthlyMessages.activeVehiclesLabel}
                value={formatNumber(activeVehicleCount, locale, 0)}
                hint={monthlyMessages.activeVehiclesHint}
              />
            </div>
            <div className="w-[52%] shrink-0 sm:w-auto">
              <MetricCard
                label={monthlyMessages.avgPerTripLabel}
                value={avgPerTrip != null ? formatCurrency(avgPerTrip, locale) : "—"}
                hint={monthlyMessages.avgPerTripHint}
              />
            </div>
          </div>
        </div>
      </section>

      {/*
       * Today / Tomorrow stacked in the wider left column; Activity
       * stays in the right column. On mobile everything stacks into
       * a single column. The left column is wrapped in its own
       * `<div className="space-y-...">` so the two day panels share
       * spacing without interfering with the outer grid's gap.
       */}
      <section className="grid gap-3 sm:gap-3.5 lg:gap-3 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-3 sm:space-y-3.5 lg:space-y-3">
          {renderDayPanel(
            dashboardMessages.todayKicker,
            dashboardMessages.todayTitle,
            todayEvents,
            dashboardMessages.todayEmpty,
          )}
          {renderDayPanel(
            dashboardMessages.tomorrowKicker,
            dashboardMessages.tomorrowTitle,
            tomorrowEvents,
            dashboardMessages.tomorrowEmpty,
          )}
        </div>

        <div className="rounded-lg border border-white/70 bg-white/90 p-3 shadow-sm sm:p-4">
          <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
            <div className="min-w-0">
              <p className="text-[9px] uppercase tracking-[0.22em] text-slate-500 sm:text-[10px] sm:tracking-[0.24em]">
                {dashboardMessages.activityKicker}
              </p>
              <h3 className="mt-0.5 font-serif text-[0.95rem] font-semibold leading-tight text-slate-950 sm:text-[1.15rem]">
                {dashboardMessages.activityTitle}
              </h3>
            </div>
            <Link href="/activity" className={panelLinkClass}>
              {dashboardMessages.openActivity}
              <span aria-hidden>→</span>
            </Link>
          </div>
          <div className="mt-2 space-y-1.5 sm:mt-2.5">
            {latestLogs.length === 0 ? (
              <p className="rounded-lg bg-slate-50 px-3 py-3.5 text-center text-[12px] text-slate-500">
                {dashboardMessages.activityEmpty}
              </p>
            ) : null}
            {latestLogs.map((log) => (
              <div key={log.id} className="rounded-lg bg-slate-50 px-3 py-1.5 sm:py-2">
                <p className="text-[12.5px] font-medium text-slate-900 sm:text-[13px]">
                  {getActivityActionLabel(log.action, locale)}
                </p>
                <p className="mt-0.5 text-[11px] leading-snug text-slate-500 sm:text-[11.5px]">
                  {log.actor} · {log.entityType} · {formatDateTime(log.createdAt, locale)}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
