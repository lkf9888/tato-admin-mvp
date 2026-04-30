import Link from "next/link";

import { prisma } from "@/lib/prisma";
import { MetricCard } from "@/components/metric-card";
import { formatDateTime } from "@/lib/utils";
import { StatusBadge } from "@/components/status-badge";
import { requireCurrentWorkspace } from "@/lib/auth";
import { getActivityActionLabel } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n-server";

export default async function DashboardPage() {
  const workspace = await requireCurrentWorkspace();
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);

  const [{ locale, messages }, todayOrders, upcomingOrders, conflictOrders, latestImport, latestLogs] =
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
    ]);
  const dashboardMessages = messages.dashboard;

  const todaysRentals = todayOrders.length;
  const todaysPickups = todayOrders.filter((order) => order.pickupDatetime >= startOfDay).length;
  const todaysReturns = todayOrders.filter((order) => order.returnDatetime <= endOfDay).length;

  return (
    <div className="space-y-4 sm:space-y-5 lg:space-y-4">
      {/*
       * Metrics strip. On phones the five cards are hot in a horizontal
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
          <p className="text-[9px] uppercase tracking-[0.22em] text-slate-500 sm:text-[11px] sm:tracking-[0.25em]">
            {dashboardMessages.activityKicker}
          </p>
          <h3 className="mt-0.5 font-serif text-[1.05rem] font-semibold leading-tight text-slate-950 sm:mt-1 sm:text-2xl">
            {dashboardMessages.activityTitle}
          </h3>
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
