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
          pickupDatetime: { gte: now },
        },
        include: { vehicle: true },
        orderBy: { pickupDatetime: "asc" },
        take: 5,
      }),
      prisma.order.findMany({
        where: { workspaceId: workspace.id, hasConflict: true },
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
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard
          label={dashboardMessages.metrics.inUseLabel}
          value={String(todaysRentals)}
          hint={dashboardMessages.metrics.inUseHint}
        />
        <MetricCard
          label={dashboardMessages.metrics.pickupsLabel}
          value={String(todaysPickups)}
          hint={dashboardMessages.metrics.pickupsHint}
        />
        <MetricCard
          label={dashboardMessages.metrics.returnsLabel}
          value={String(todaysReturns)}
          hint={dashboardMessages.metrics.returnsHint}
        />
        <MetricCard
          label={dashboardMessages.metrics.conflictsLabel}
          value={String(conflictOrders.length)}
          hint={dashboardMessages.metrics.conflictsHint}
        />
        <MetricCard
          label={dashboardMessages.metrics.lastSyncLabel}
          value={
            latestImport
              ? formatDateTime(latestImport.importedAt, locale)
              : dashboardMessages.metrics.never
          }
          hint={dashboardMessages.metrics.lastSyncHint}
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-lg border border-white/70 bg-white/90 p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.25em] text-slate-500">
                {dashboardMessages.upcomingKicker}
              </p>
              <h3 className="mt-2 font-serif text-3xl text-slate-950">
                {dashboardMessages.upcomingTitle}
              </h3>
            </div>
            <a href="/orders" className="text-sm font-medium text-slate-600">
              {dashboardMessages.openOrders}
            </a>
          </div>

          <div className="mt-6 space-y-3">
            {upcomingOrders.map((order) => (
              <div
                key={order.id}
                className="flex flex-col gap-3 rounded-lg border border-slate-200 px-5 py-4 md:flex-row md:items-center md:justify-between"
              >
                <div>
                  <p className="font-semibold text-slate-900">
                    {order.vehicle.nickname} · {order.renterName}
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    {formatDateTime(order.pickupDatetime, locale)} -{" "}
                    {formatDateTime(order.returnDatetime, locale)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge value={order.source} locale={locale} />
                  <StatusBadge value={order.status} locale={locale} />
                  {order.hasConflict ? <StatusBadge value="conflict" locale={locale} /> : null}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-white/70 bg-white/90 p-6 shadow-sm">
          <p className="text-xs uppercase tracking-[0.25em] text-slate-500">
            {dashboardMessages.activityKicker}
          </p>
          <h3 className="mt-2 font-serif text-3xl text-slate-950">
            {dashboardMessages.activityTitle}
          </h3>
          <div className="mt-6 space-y-4">
            {latestLogs.map((log) => (
              <div key={log.id} className="rounded-lg bg-slate-50 px-4 py-4">
                <p className="font-medium text-slate-900">
                  {getActivityActionLabel(log.action, locale)}
                </p>
                <p className="mt-1 text-sm text-slate-500">
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
