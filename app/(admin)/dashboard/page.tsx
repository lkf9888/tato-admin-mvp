import Link from "next/link";

import { prisma } from "@/lib/prisma";
import { MetricCard } from "@/components/metric-card";
import {
  formatCurrency,
  formatDateTime,
  formatNumber,
  formatPercentage,
  getOrderNetEarning,
} from "@/lib/utils";
import { StatusBadge } from "@/components/status-badge";
import { requireCurrentWorkspace } from "@/lib/auth";
import { getActivityActionLabel, getLocaleTag } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n-server";

export default async function DashboardPage() {
  const workspace = await requireCurrentWorkspace();
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);

  // Month boundaries for the new "This month" overview. We pull both
  // the current month and last month in a single query (one round
  // trip), then bucket in JS — Prisma doesn't ship `GROUP BY month`
  // on SQLite without raw SQL, and the order count for any single
  // workspace's two months stays in the low hundreds in practice.
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

  const [{ locale, messages }, todayOrders, upcomingOrders, conflictOrders, latestImport, latestLogs, monthlyOrders] =
    await Promise.all([
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
      prisma.order.findMany({
        where: {
          workspaceId: workspace.id,
          isArchived: false,
          pickupDatetime: { gte: now },
          status: { not: "cancelled" },
        },
        include: { vehicle: true },
        orderBy: { pickupDatetime: "asc" },
        take: 5,
      }),
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

  return (
    <div className="space-y-4 sm:space-y-5 lg:space-y-4">
      {/*
       * Daily-snapshot strip. On phones the five cards are hot in a horizontal
       * snap-scroll row — same pattern App Store / Apple Wallet use for
       * widget rows. The negative horizontal margin (-mx-3) lets the
       * row bleed all the way to the screen edge so the right-most
       * card hints "swipe me" without pretending the page has more
       * margin than it does. On `sm:` and up we revert to the original
       * static grid.
       */}
      <section className="-mx-3 overflow-x-auto px-3 pb-1 sm:mx-0 sm:px-0 sm:pb-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex snap-x snap-mandatory gap-3 sm:grid sm:grid-cols-2 sm:gap-4 xl:grid-cols-5">
          <div className="w-[58%] shrink-0 sm:w-auto">
            <MetricCard
              label={dashboardMessages.metrics.inUseLabel}
              value={String(todaysRentals)}
              hint={dashboardMessages.metrics.inUseHint}
            />
          </div>
          <div className="w-[58%] shrink-0 sm:w-auto">
            <MetricCard
              label={dashboardMessages.metrics.pickupsLabel}
              value={String(todaysPickups)}
              hint={dashboardMessages.metrics.pickupsHint}
            />
          </div>
          <div className="w-[58%] shrink-0 sm:w-auto">
            <MetricCard
              label={dashboardMessages.metrics.returnsLabel}
              value={String(todaysReturns)}
              hint={dashboardMessages.metrics.returnsHint}
            />
          </div>
          <div className="w-[58%] shrink-0 sm:w-auto">
            <MetricCard
              label={dashboardMessages.metrics.conflictsLabel}
              value={String(conflictOrders.length)}
              hint={dashboardMessages.metrics.conflictsHint}
            />
          </div>
          <div className="w-[58%] shrink-0 sm:w-auto">
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
      <section className="space-y-2.5">
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
          <p className="text-[10px] uppercase tracking-[0.24em] text-[color:var(--ink-soft)] sm:text-[11px] sm:tracking-[0.28em]">
            {dashboardMessages.monthlyKicker}
          </p>
          <p className="text-[11px] text-[color:var(--ink-soft)] sm:text-[12px]">{monthlyMessages.title(monthLabel)}</p>
        </div>
        <div className="-mx-3 overflow-x-auto px-3 pb-1 sm:mx-0 sm:px-0 sm:pb-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="flex snap-x snap-mandatory gap-3 sm:grid sm:grid-cols-2 sm:gap-4 xl:grid-cols-4">
            <div className="w-[58%] shrink-0 sm:w-auto">
              <MetricCard
                label={monthlyMessages.netLabel}
                value={formatCurrency(currentMonthNet, locale)}
                hint={netHint}
              />
            </div>
            <div className="w-[58%] shrink-0 sm:w-auto">
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
            <div className="w-[58%] shrink-0 sm:w-auto">
              <MetricCard
                label={monthlyMessages.activeVehiclesLabel}
                value={formatNumber(activeVehicleCount, locale, 0)}
                hint={monthlyMessages.activeVehiclesHint}
              />
            </div>
            <div className="w-[58%] shrink-0 sm:w-auto">
              <MetricCard
                label={monthlyMessages.avgPerTripLabel}
                value={avgPerTrip != null ? formatCurrency(avgPerTrip, locale) : "—"}
                hint={monthlyMessages.avgPerTripHint}
              />
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 sm:gap-5 lg:gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        {/* Upcoming orders panel. Each row is a tappable Link to /orders
         * so the whole card behaves like a list cell on iOS — finger
         * anywhere on the row navigates. The mobile padding is tighter
         * (p-4) than desktop (sm:p-5) so the cards don't waste an inch
         * of margin on a 375px screen. v0.19.1 dropped desktop padding
         * one tier (p-6 → p-5) and the title from text-3xl → text-xl
         * so each panel reads as a tight info card rather than an
         * editorial spread. */}
        <div className="rounded-lg border border-white/70 bg-white/90 p-4 shadow-sm sm:p-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
            <div className="min-w-0">
              <p className="text-[9px] uppercase tracking-[0.22em] text-slate-500 sm:text-[11px] sm:tracking-[0.25em]">
                {dashboardMessages.upcomingKicker}
              </p>
              <h3 className="mt-0.5 font-serif text-[1.05rem] font-semibold leading-tight text-slate-950 sm:mt-1 sm:text-2xl">
                {dashboardMessages.upcomingTitle}
              </h3>
            </div>
            <Link
              href="/orders"
              className="tap-press inline-flex w-fit items-center gap-1 self-start rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 sm:self-auto"
            >
              {dashboardMessages.openOrders}
              <span aria-hidden>→</span>
            </Link>
          </div>

          <div className="mt-3 space-y-2 sm:mt-4 sm:space-y-2.5">
            {upcomingOrders.length === 0 ? (
              <p className="rounded-lg bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                {dashboardMessages.upcomingEmpty}
              </p>
            ) : null}
            {upcomingOrders.map((order) => (
              <Link
                key={order.id}
                href="/orders"
                className="tap-press flex flex-col gap-2 rounded-lg border border-slate-200 px-4 py-3 hover:border-slate-300 hover:bg-slate-50/50 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:px-5 sm:py-4"
              >
                <div className="min-w-0">
                  <p className="truncate font-semibold text-slate-900">
                    {order.vehicle.nickname} · {order.renterName}
                  </p>
                  <p className="mt-1 text-[12px] leading-snug text-slate-500 sm:text-sm">
                    {formatDateTime(order.pickupDatetime, locale)} —{" "}
                    {formatDateTime(order.returnDatetime, locale)}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 sm:flex-nowrap sm:gap-2">
                  <StatusBadge value={order.source} locale={locale} />
                  <StatusBadge value={order.status} locale={locale} />
                  {order.hasConflict ? <StatusBadge value="conflict" locale={locale} /> : null}
                </div>
              </Link>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-white/70 bg-white/90 p-4 shadow-sm sm:p-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
            <div className="min-w-0">
              <p className="text-[9px] uppercase tracking-[0.22em] text-slate-500 sm:text-[11px] sm:tracking-[0.25em]">
                {dashboardMessages.activityKicker}
              </p>
              <h3 className="mt-0.5 font-serif text-[1.05rem] font-semibold leading-tight text-slate-950 sm:mt-1 sm:text-2xl">
                {dashboardMessages.activityTitle}
              </h3>
            </div>
            <Link
              href="/activity"
              className="tap-press inline-flex w-fit items-center gap-1 self-start rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 sm:self-auto"
            >
              {dashboardMessages.openActivity}
              <span aria-hidden>→</span>
            </Link>
          </div>
          <div className="mt-3 space-y-2 sm:mt-4 sm:space-y-2.5">
            {latestLogs.length === 0 ? (
              <p className="rounded-lg bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                {dashboardMessages.activityEmpty}
              </p>
            ) : null}
            {latestLogs.map((log) => (
              <div
                key={log.id}
                className="rounded-lg bg-slate-50 px-4 py-3 sm:py-4"
              >
                <p className="font-medium text-slate-900">
                  {getActivityActionLabel(log.action, locale)}
                </p>
                <p className="mt-1 text-[12px] leading-snug text-slate-500 sm:text-sm">
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
