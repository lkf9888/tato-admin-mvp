import { ChevronRight } from "lucide-react";
import Link from "next/link";

import { prisma } from "@/lib/prisma";
import {
  cn,
  formatCurrency,
  formatCurrencyCompact,
  formatDate,
  formatDateTime,
  formatTime,
  formatNumber,
  formatPercentage,
  getOrderNetEarning,
  turoReservationUrl,
} from "@/lib/utils";
import { CsvQuickImportButton } from "@/components/csv-quick-import-button";
import { OrderClickTracker } from "@/components/order-click-tracker";
import { StatusBadge } from "@/components/status-badge";
import { requireAccessContext } from "@/lib/auth";
import { recentOrderViews } from "@/lib/recent-orders";
import { getActivityActionLabel, getLocaleTag, type Locale } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n-server";

/**
 * Strip the rendered datetime down to "10:30 AM" / "10:30" — when
 * the panel header already says "Today" or "Tomorrow", showing the
 * full date next to every event is noise. Falls back to the locale-
 * appropriate hour:minute pattern.
 */
function formatTimeOnly(date: Date): string {
  return formatTime(date);
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
        // A Turo trip ends where it started unless the guest arranged
        // otherwise, and an order made from Turo's booking email only
        // knows the pickup spot -- so a return without its own place
        // shows the pickup's rather than "no location".
        location: order.returnLocation?.trim() || order.pickupLocation,
        order,
      });
    }
  }
  return events.sort((a, b) => a.time.getTime() - b.time.getTime());
}

export default async function DashboardPage() {
  const { workspace, user, vehicleIds } = await requireAccessContext();
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
    recentOrders,
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
    recentOrderViews({ workspaceId: workspace.id, userId: user.id, vehicleIds }),
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

  // One pickup or return, on one line on a laptop and two on a phone.
  //
  // A Turo trip opens the guest conversation on turo.com -- the reason
  // anyone taps a pickup is usually to message the guest about it. On a
  // phone with the Turo app, the OS opens that link in the app. Any
  // other order opens its own page here rather than the whole orders
  // list, which is where the old row went.
  const renderEvent = (event: DayEvent) => {
    const isPickup = event.kind === "pickup";
    const order = event.order;
    const turoChat = turoReservationUrl(order, "messages");
    const location = event.location?.trim();
    const rowClass =
      "tap-press group grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-0.5 rounded-md px-2 py-1.5 hover:bg-[var(--surface-muted)]";

    const content = (
      <>
        <span className="flex items-center gap-1.5">
          <span
            className={cn(
              "inline-flex w-9 justify-center rounded px-1 py-0.5 text-[10px] font-semibold",
              isPickup ? "bg-[var(--accent-soft)] text-[var(--ink)]" : "bg-[var(--ink)] text-white",
            )}
          >
            {isPickup ? eventMessages.pickupBadge : eventMessages.returnBadge}
          </span>
          <span className="w-11 text-[12px] font-semibold tabular-nums text-[var(--ink)]">
            {formatTimeOnly(event.time)}
          </span>
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[12.5px] font-semibold text-[var(--ink)]">
            {order.vehicle.plateNumber || order.vehicle.nickname}
            <span className="font-normal text-[var(--ink-soft)]"> · </span>
            {order.renterName}
          </span>
          <span
            className="block truncate text-[11px] text-[var(--ink-soft)]"
            title={location || undefined}
          >
            {order.vehicle.plateNumber ? `${order.vehicle.nickname} · ` : ""}
            {location || eventMessages.noLocation}
          </span>
        </span>
        <span className="flex items-center gap-1">
          {order.hasConflict ? <StatusBadge value="conflict" locale={locale} /> : null}
          {order.source !== "turo" ? <StatusBadge value={order.source} locale={locale} /> : null}
          <span
            aria-hidden
            className="text-[12px] text-[var(--ink-soft)] group-hover:text-[var(--brand)]"
          >
            {turoChat ? "↗" : "›"}
          </span>
        </span>
      </>
    );

    return turoChat ? (
      <a
        key={`${order.id}-${event.kind}`}
        href={turoChat}
        target="_blank"
        rel="noopener noreferrer"
        title={eventMessages.openTuroChat}
        data-order-id={order.id}
        className={rowClass}
      >
        {content}
      </a>
    ) : (
      <Link
        key={`${order.id}-${event.kind}`}
        href={`/orders/${order.id}`}
        title={eventMessages.openOrder}
        data-order-id={order.id}
        className={rowClass}
      >
        {content}
      </Link>
    );
  };

  // A recently opened order: the same row as a pickup or return, with
  // its dates where the time was. It opens the order's page here.
  const renderRecent = (order: (typeof recentOrders)[number]) => (
    <Link
      key={order.id}
      href={`/orders/${order.id}`}
      title={eventMessages.openOrder}
      data-order-id={order.id}
      className="tap-press group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 rounded-md px-2 py-1.5 hover:bg-[var(--surface-muted)]"
    >
      <span className="min-w-0">
        <span className="block truncate text-[12.5px] font-semibold text-[var(--ink)]">
          {order.vehicle.plateNumber || order.vehicle.nickname}
          <span className="font-normal text-[var(--ink-soft)]"> · </span>
          {order.renterName}
        </span>
        <span className="block truncate text-[11px] tabular-nums text-[var(--ink-soft)]">
          {order.vehicle.plateNumber ? `${order.vehicle.nickname} · ` : ""}
          {dashboardMessages.recentDates(formatDate(order.pickupDatetime, locale), formatDate(order.returnDatetime, locale))}
        </span>
      </span>
      <span className="flex items-center gap-1">
        {order.status === "cancelled" ? <StatusBadge value="cancelled" locale={locale} /> : null}
        {order.source !== "turo" ? <StatusBadge value={order.source} locale={locale} /> : null}
        <span aria-hidden className="text-[12px] text-[var(--ink-soft)] group-hover:text-[var(--brand)]">
          ›
        </span>
      </span>
    </Link>
  );

  const panelLinkClass =
    "tap-press shrink-0 text-[11px] font-medium text-[var(--ink-soft)] hover:text-[var(--brand)]";

  const renderPanel = (
    title: string,
    count: number | null,
    link: { href: string; label: string },
    body: React.ReactNode,
  ) => (
    <section className="flex min-w-0 flex-col rounded-lg border border-[var(--line)] bg-[var(--surface)] p-2 sm:p-2.5">
      <header className="flex items-baseline justify-between gap-2 px-1 pb-1">
        <h3 className="truncate text-[13px] font-semibold text-[var(--ink)]">
          {title}
          {count != null ? (
            <span className="ml-1.5 text-[12px] font-normal tabular-nums text-[var(--ink-soft)]">
              {count}
            </span>
          ) : null}
        </h3>
        <Link href={link.href} className={panelLinkClass}>
          {link.label} →
        </Link>
      </header>
      <div className="space-y-0.5">{body}</div>
    </section>
  );

  const emptyRow = (message: string) => (
    <p className="rounded-md bg-[var(--surface-muted)] px-2 py-2.5 text-center text-[12px] text-[var(--ink-soft)]">
      {message}
    </p>
  );

  // Nine numbers in one strip rather than nine cards in two sections:
  // the whole state of the business in one row on a laptop, three rows
  // of three on a phone. The explanations that used to sit under each
  // number are on hover, where they cost no height.
  const stats: Array<{ label: string; value: string; hint: string; sub?: string; tone?: "alert" }> = [
    {
      label: dashboardMessages.metrics.inUseLabel,
      value: String(todaysRentals),
      hint: dashboardMessages.metrics.inUseHint,
    },
    {
      label: dashboardMessages.metrics.pickupsLabel,
      value: String(todaysPickups),
      hint: dashboardMessages.metrics.pickupsHint,
    },
    {
      label: dashboardMessages.metrics.returnsLabel,
      value: String(todaysReturns),
      hint: dashboardMessages.metrics.returnsHint,
    },
    {
      label: dashboardMessages.metrics.conflictsLabel,
      value: String(conflictOrders.length),
      hint: dashboardMessages.metrics.conflictsHint,
      tone: conflictOrders.length > 0 ? "alert" : undefined,
    },
    {
      label: dashboardMessages.metrics.lastSyncLabel,
      value: latestImport
        ? formatDateTime(latestImport.importedAt, locale)
        : dashboardMessages.metrics.never,
      hint: dashboardMessages.metrics.lastSyncHint,
    },
    {
      label: monthlyMessages.netLabel,
      value: formatCurrencyCompact(currentMonthNet, locale),
      hint: `${formatCurrency(currentMonthNet, locale)} · ${netHint}`,
      sub: deltaHint,
    },
    {
      label: monthlyMessages.tripsLabel,
      value: formatNumber(currentMonthTripCount, locale, 0),
      hint: currentMonthTripCount === 0 ? monthlyMessages.emptyMonth : monthlyMessages.tripsHint,
    },
    {
      label: monthlyMessages.activeVehiclesLabel,
      value: formatNumber(activeVehicleCount, locale, 0),
      hint: monthlyMessages.activeVehiclesHint,
    },
    {
      label: monthlyMessages.avgPerTripLabel,
      value: avgPerTrip != null ? formatCurrencyCompact(avgPerTrip, locale) : "—",
      hint: `${avgPerTrip != null ? `${formatCurrency(avgPerTrip, locale)} · ` : ""}${monthlyMessages.avgPerTripHint}`,
    },
  ];

  return (
    <div className="space-y-2.5">
      <section
        aria-label={`${dashboardMessages.todayKicker} · ${monthlyMessages.title(monthLabel)}`}
        className="grid grid-cols-3 overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--line)] [gap:1px] sm:grid-cols-5 xl:grid-cols-9"
      >
        {stats.map((stat, index) => (
          <div
            key={stat.label}
            title={stat.hint}
            className={cn(
              "min-w-0 bg-[var(--surface)] px-2.5 py-2",
              // The month's four start a new row below xl; a faint
              // tint marks where "today" ends and "this month" begins.
              index >= 5 && "bg-[var(--surface-muted)]/40",
            )}
          >
            <p className="truncate text-[10.5px] leading-tight text-[var(--ink-soft)]">{stat.label}</p>
            <p
              className={cn(
                "mt-0.5 truncate text-[16px] font-semibold leading-tight tabular-nums sm:text-[17px]",
                stat.tone === "alert" ? "text-[var(--bad-fg)]" : "text-[var(--ink)]",
                // The last-sync timestamp is a sentence, not a number.
                index === 4 && "text-[12px] sm:text-[12.5px]",
              )}
            >
              {stat.value}
            </p>
            {stat.sub ? (
              <p className="truncate text-[10px] leading-tight text-[var(--ink-soft)]">{stat.sub}</p>
            ) : null}
          </div>
        ))}
      </section>

      {/* One click to bring the latest Turo export in, on the settings
          the last import used. The component is the sync's; it owns the
          upload, the result lines and the refresh. */}
      <div className="flex justify-end">
        <CsvQuickImportButton locale={locale} />
      </div>

      <OrderClickTracker className="grid items-start gap-2.5 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-2.5">
          {renderPanel(
            dashboardMessages.recentTitle,
            null,
            { href: "/orders", label: dashboardMessages.openOrders },
            recentOrders.length === 0 ? emptyRow(dashboardMessages.recentEmpty) : recentOrders.map(renderRecent),
          )}
          {renderPanel(
            `${dashboardMessages.todayKicker} · ${dashboardMessages.todayTitle}`,
            todayEvents.length,
            { href: "/orders", label: dashboardMessages.openOrders },
            todayEvents.length === 0 ? emptyRow(dashboardMessages.todayEmpty) : todayEvents.map(renderEvent),
          )}
        </div>
        {renderPanel(
          `${dashboardMessages.tomorrowKicker} · ${dashboardMessages.tomorrowTitle}`,
          tomorrowEvents.length,
          { href: "/orders", label: dashboardMessages.openOrders },
          tomorrowEvents.length === 0
            ? emptyRow(dashboardMessages.tomorrowEmpty)
            : tomorrowEvents.map(renderEvent),
        )}
        {/* Folded: what happened lately is worth a glance now and then,
            not the height of the page every time. */}
        <details className="group/activity min-w-0 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-2 sm:p-2.5">
          <summary className="tap-press cursor-pointer list-none px-1 [&::-webkit-details-marker]:hidden">
            <span className="flex items-baseline justify-between gap-2">
              <h3 className="flex min-w-0 items-center gap-1 text-[13px] font-semibold text-[var(--ink)]">
                <ChevronRight
                  aria-hidden
                  className="size-3.5 shrink-0 text-[var(--ink-soft)] transition group-open/activity:rotate-90"
                />
                <span className="truncate">{dashboardMessages.activityTitle}</span>
              </h3>
              <Link href="/activity" className={panelLinkClass}>
                {dashboardMessages.openActivity} →
              </Link>
            </span>
            {/* Closed, it still says what happened last. */}
            {latestLogs[0] ? (
              <span className="mt-0.5 block truncate pl-[18px] text-[11px] text-[var(--ink-soft)] group-open/activity:hidden">
                {getActivityActionLabel(latestLogs[0].action, locale)} · {latestLogs[0].actor} ·{" "}
                {formatDateTime(latestLogs[0].createdAt, locale)}
              </span>
            ) : null}
          </summary>
          <div className="mt-1 space-y-0.5">
            {latestLogs.length === 0
              ? emptyRow(dashboardMessages.activityEmpty)
              : latestLogs.map((log) => (
                  <div key={log.id} className="flex items-baseline justify-between gap-2 rounded-md px-2 py-1.5">
                    <span className="min-w-0">
                      <span className="block truncate text-[12.5px] font-medium text-[var(--ink)]">
                        {getActivityActionLabel(log.action, locale)}
                      </span>
                      <span className="block truncate text-[11px] text-[var(--ink-soft)]">{log.actor}</span>
                    </span>
                    <span className="shrink-0 text-[11px] tabular-nums text-[var(--ink-soft)]">
                      {formatDateTime(log.createdAt, locale)}
                    </span>
                  </div>
                ))}
          </div>
        </details>
      </OrderClickTracker>
    </div>
  );
}
