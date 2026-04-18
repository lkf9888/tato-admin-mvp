import { saveVehiclePurchasePriceAction } from "@/app/actions";
import { requireCurrentWorkspace } from "@/lib/auth";
import { getI18n } from "@/lib/i18n-server";
import { prisma } from "@/lib/prisma";
import {
  formatCurrency,
  formatNumber,
  formatPercentage,
  getImportedOrderDistanceKilometers,
  getOrderNetEarning,
} from "@/lib/utils";

function startOfMonth(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), 1);
}

function addMonths(value: Date, amount: number) {
  return new Date(value.getFullYear(), value.getMonth() + amount, 1);
}

function buildMonthKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}`;
}

function buildMonthLabel(value: Date, locale: "en" | "zh") {
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-CA", {
    month: locale === "zh" ? "numeric" : "short",
    year: "2-digit",
  }).format(value);
}

export default async function VehicleRoiPage() {
  const workspace = await requireCurrentWorkspace();
  const [{ locale, messages }, vehicles] = await Promise.all([
    getI18n(),
    prisma.vehicle.findMany({
      where: { workspaceId: workspace.id },
      include: {
        owner: true,
        orders: {
          orderBy: { pickupDatetime: "desc" },
        },
      },
      orderBy: { plateNumber: "asc" },
    }),
  ]);

  const roiMessages = messages.vehicleRoiPage;
  const now = new Date();
  const currentMonthStart = startOfMonth(now);
  const trailingTwelveMonthStart = addMonths(currentMonthStart, -11);
  const monthTimeline = Array.from({ length: 6 }, (_, index) => addMonths(currentMonthStart, index - 5));
  const monthTimelineKeys = new Set(monthTimeline.map(buildMonthKey));

  const vehicleMetricsUnsorted = vehicles.map((vehicle) => {
    const activeOrders = vehicle.orders.filter((order) => order.status !== "cancelled");
    const monthlyRevenueMap = new Map(monthTimeline.map((month) => [buildMonthKey(month), 0]));
    let currentMonthRevenue = 0;
    let trailingTwelveMonthRevenue = 0;
    let distanceTrackedKm = 0;
    let distanceTrackedRevenue = 0;

    for (const order of activeOrders) {
      const netEarning = getOrderNetEarning(order.sourceMetadata, order.totalPrice) ?? 0;
      const pickupMonthKey = buildMonthKey(order.pickupDatetime);

      if (monthTimelineKeys.has(pickupMonthKey)) {
        monthlyRevenueMap.set(pickupMonthKey, (monthlyRevenueMap.get(pickupMonthKey) ?? 0) + netEarning);
      }

      if (pickupMonthKey === buildMonthKey(currentMonthStart)) {
        currentMonthRevenue += netEarning;
      }

      if (order.pickupDatetime >= trailingTwelveMonthStart) {
        trailingTwelveMonthRevenue += netEarning;
      }

      const distanceKilometers = getImportedOrderDistanceKilometers(order.sourceMetadata);
      if (distanceKilometers != null && distanceKilometers > 0) {
        distanceTrackedKm += distanceKilometers;
        distanceTrackedRevenue += netEarning;
      }
    }

    const revenuePerKm =
      distanceTrackedKm > 0 ? distanceTrackedRevenue / distanceTrackedKm : null;
    const annualizedReturnPct =
      vehicle.purchasePrice != null && vehicle.purchasePrice > 0
        ? (trailingTwelveMonthRevenue / vehicle.purchasePrice) * 100
        : null;

    return {
      vehicle,
      currentMonthRevenue,
      trailingTwelveMonthRevenue,
      distanceTrackedKm,
      distanceTrackedRevenue,
      revenuePerKm,
      annualizedReturnPct,
      monthlyRevenue: monthTimeline.map((month) => ({
        key: buildMonthKey(month),
        label: buildMonthLabel(month, locale),
        revenue: monthlyRevenueMap.get(buildMonthKey(month)) ?? 0,
      })),
    };
  });

  const vehicleMetrics = [...vehicleMetricsUnsorted].sort((a, b) => {
    if (a.revenuePerKm == null && b.revenuePerKm == null) return 0;
    if (a.revenuePerKm == null) return 1;
    if (b.revenuePerKm == null) return -1;
    return b.revenuePerKm - a.revenuePerKm;
  });

  const fleetMonthRevenue = vehicleMetrics.reduce((sum, item) => sum + item.currentMonthRevenue, 0);
  const fleetDistanceTrackedKm = vehicleMetrics.reduce((sum, item) => sum + item.distanceTrackedKm, 0);
  const fleetDistanceTrackedRevenue = vehicleMetrics.reduce(
    (sum, item) => sum + item.distanceTrackedRevenue,
    0,
  );
  const fleetRevenuePerKm =
    fleetDistanceTrackedKm > 0 ? fleetDistanceTrackedRevenue / fleetDistanceTrackedKm : null;
  const pricedVehicleCount = vehicleMetrics.filter(
    ({ vehicle }) => vehicle.purchasePrice != null && vehicle.purchasePrice > 0,
  ).length;

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-lg border border-[color:var(--line)] bg-[linear-gradient(140deg,rgba(255,255,255,0.92),rgba(247, 247, 247, 0.96))] p-6 shadow-[0_24px_60px_-42px_rgba(17,19,24,0.45)]">
        <p className="text-xs uppercase tracking-[0.28em] text-[color:var(--ink-soft)]">
          {roiMessages.kicker}
        </p>
        <h2 className="mt-2 font-serif text-[2.2rem] leading-tight text-[color:var(--ink)]">
          {roiMessages.title}
        </h2>
        <p className="mt-3 max-w-4xl text-sm leading-6 text-[color:var(--ink-soft)]">
          {roiMessages.copy}
        </p>

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <div className="rounded-lg border border-[rgba(17,19,24,0.06)] bg-[rgba(255,255,255,0.72)] px-5 py-4 shadow-[0_18px_38px_-34px_rgba(17,19,24,0.45)]">
            <p className="text-[11px] uppercase tracking-[0.18em] text-[color:var(--ink-soft)]">
              {roiMessages.fleetMonthRevenue}
            </p>
            <p className="mt-3 text-[2rem] font-semibold text-[color:var(--ink)]">
              {formatCurrency(fleetMonthRevenue, locale)}
            </p>
          </div>
          <div className="rounded-lg border border-[rgba(17,19,24,0.06)] bg-[rgba(255,255,255,0.72)] px-5 py-4 shadow-[0_18px_38px_-34px_rgba(17,19,24,0.45)]">
            <p className="text-[11px] uppercase tracking-[0.18em] text-[color:var(--ink-soft)]">
              {roiMessages.fleetRevenuePerKm}
            </p>
            <p className="mt-3 text-[2rem] font-semibold text-[color:var(--ink)]">
              {fleetRevenuePerKm != null ? `${formatCurrency(fleetRevenuePerKm, locale)} / km` : "—"}
            </p>
            <p className="mt-2 text-[12px] text-[color:var(--ink-soft)]">
              {fleetDistanceTrackedKm > 0
                ? roiMessages.trackedDistance(formatNumber(fleetDistanceTrackedKm, locale, 0))
                : roiMessages.missingDistance}
            </p>
          </div>
          <div className="rounded-lg border border-[rgba(17,19,24,0.06)] bg-[rgba(255,255,255,0.72)] px-5 py-4 shadow-[0_18px_38px_-34px_rgba(17,19,24,0.45)]">
            <p className="text-[11px] uppercase tracking-[0.18em] text-[color:var(--ink-soft)]">
              {roiMessages.pricedVehicles}
            </p>
            <p className="mt-3 text-[2rem] font-semibold text-[color:var(--ink)]">
              {pricedVehicleCount} / {vehicleMetrics.length}
            </p>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        {vehicleMetrics.length === 0 ? (
          <div className="rounded-lg border border-[color:var(--line)] bg-[rgba(255, 255, 255, 0.88)] px-6 py-8 text-sm text-[color:var(--ink-soft)] shadow-[0_20px_50px_-40px_rgba(17,19,24,0.4)]">
            {roiMessages.emptyState}
          </div>
        ) : null}

        {vehicleMetrics.map((item, index) => (
          <article
            key={item.vehicle.id}
            className="overflow-hidden rounded-lg border border-[color:var(--line)] bg-[rgba(255, 255, 255, 0.88)] shadow-[0_20px_50px_-40px_rgba(17,19,24,0.4)]"
          >
            <div className="bg-[linear-gradient(180deg,rgba(255, 255, 255, 0.98),rgba(247, 247, 247, 0.98))] px-5 py-5">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="flex items-start gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-[var(--ink)] text-lg font-semibold tabular-nums text-white">
                    #{index + 1}
                  </div>
                  <div>
                    <h3 className="font-serif text-[1.6rem] leading-tight text-[color:var(--ink)]">
                      {item.vehicle.plateNumber} · {item.vehicle.nickname}
                    </h3>
                    <p className="mt-1 text-sm text-[color:var(--ink-soft)]">
                      {item.vehicle.brand} {item.vehicle.model} · {item.vehicle.year}
                    </p>
                    <p className="text-sm text-[color:var(--ink-soft)]">
                      {item.vehicle.owner?.name ?? messages.vehicles.placeholders.unassignedOwner}
                    </p>
                  </div>
                </div>
                <div className="rounded-full bg-white/72 px-4 py-2 text-[11px] font-semibold text-[color:var(--ink-soft)] shadow-[0_14px_28px_-24px_rgba(17,19,24,0.45)]">
                  {roiMessages.monthSummary(item.monthlyRevenue.length)}
                </div>
              </div>

              <div className="mt-5 grid gap-4 lg:grid-cols-3">
                <section className="min-w-0 rounded-lg border border-[rgba(17,19,24,0.06)] bg-[rgba(255,255,255,0.72)] px-4 py-4">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-[color:var(--ink-soft)]">
                    {roiMessages.monthlyRevenueTitle}
                  </p>
                  <p className="mt-2 text-[12px] text-[color:var(--ink-soft)]">
                    {roiMessages.monthlyRevenueHint}
                  </p>
                  <div className="mt-4 rounded-md bg-white/78 px-4 py-3">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--ink-soft)]">
                      {roiMessages.currentMonth}
                    </p>
                    <p className="mt-2 break-words text-[1.4rem] font-semibold tabular-nums text-[color:var(--ink)]">
                      {formatCurrency(item.currentMonthRevenue, locale)}
                    </p>
                  </div>
                  <div className="mt-4 space-y-1.5">
                    {item.monthlyRevenue.map((month) => (
                      <div
                        key={month.key}
                        className="flex items-center justify-between gap-3 rounded-md bg-white/64 px-3 py-2"
                      >
                        <p className="text-[11px] uppercase tracking-[0.12em] text-[color:var(--ink-soft)]">
                          {month.label}
                        </p>
                        <p className="text-[13px] font-semibold tabular-nums text-[color:var(--ink)]">
                          {formatCurrency(month.revenue, locale)}
                        </p>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="min-w-0 rounded-lg border border-[rgba(17,19,24,0.06)] bg-[rgba(255,255,255,0.72)] px-4 py-4">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-[color:var(--ink-soft)]">
                    {roiMessages.perKmTitle}
                  </p>
                  <p className="mt-2 text-[12px] text-[color:var(--ink-soft)]">
                    {roiMessages.perKmHint}
                  </p>
                  <div className="mt-4 rounded-md bg-white/78 px-4 py-3">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--ink-soft)]">
                      {roiMessages.perKmTitle}
                    </p>
                    <p className="mt-2 break-words text-[1.4rem] font-semibold tabular-nums text-[color:var(--ink)]">
                      {item.revenuePerKm != null ? `${formatCurrency(item.revenuePerKm, locale)} / km` : "—"}
                    </p>
                  </div>
                  <div className="mt-4 space-y-2 text-[13px] text-[color:var(--ink-soft)]">
                    {item.distanceTrackedKm > 0 ? (
                      <>
                        <p>{roiMessages.trackedDistance(formatNumber(item.distanceTrackedKm, locale, 0))}</p>
                        <p>{roiMessages.distanceRevenue(formatCurrency(item.distanceTrackedRevenue, locale))}</p>
                      </>
                    ) : (
                      <p>{roiMessages.missingDistance}</p>
                    )}
                  </div>
                </section>

                <section className="min-w-0 rounded-lg border border-[rgba(17,19,24,0.06)] bg-[linear-gradient(180deg,rgba(17,19,24,0.96),rgba(24,30,41,0.96))] px-4 py-4 text-white">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-white/60">
                    {roiMessages.annualizedTitle}
                  </p>
                  <p className="mt-2 text-[12px] text-white/60">
                    {roiMessages.annualizedHint}
                  </p>
                  <div className="mt-4 rounded-md bg-white/8 px-4 py-3">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-white/50">
                      {roiMessages.annualizedLabel}
                    </p>
                    <p className="mt-2 break-words text-[1.4rem] font-semibold tabular-nums text-white">
                      {item.annualizedReturnPct != null
                        ? formatPercentage(item.annualizedReturnPct, locale, 1)
                        : "—"}
                    </p>
                  </div>
                  <div className="mt-4 space-y-1 text-[13px] text-white/72">
                    <p className="flex flex-wrap items-baseline justify-between gap-2">
                      <span>{roiMessages.trailingRevenueLabel}</span>
                      <span className="font-semibold tabular-nums text-white">
                        {formatCurrency(item.trailingTwelveMonthRevenue, locale)}
                      </span>
                    </p>
                    <p className="flex flex-wrap items-baseline justify-between gap-2">
                      <span>{roiMessages.purchasePriceLabel}</span>
                      <span className="font-semibold tabular-nums text-white">
                        {item.vehicle.purchasePrice != null
                          ? formatCurrency(item.vehicle.purchasePrice, locale)
                          : "—"}
                      </span>
                    </p>
                  </div>
                  <form action={saveVehiclePurchasePriceAction} className="mt-4 flex flex-col gap-3">
                    <input type="hidden" name="id" value={item.vehicle.id} />
                    <input
                      name="purchasePrice"
                      type="number"
                      step="0.01"
                      min="0"
                      defaultValue={item.vehicle.purchasePrice ?? ""}
                      placeholder={roiMessages.purchasePriceLabel}
                      className="h-11 rounded-full border border-white/12 bg-white/8 px-4 text-sm text-white outline-none placeholder:text-white/35"
                    />
                    <button className="inline-flex h-11 items-center justify-center rounded-full bg-[var(--accent)] px-4 text-[12px] font-semibold text-[color:var(--ink)] shadow-[0_18px_38px_-20px_rgba(89, 60, 251, 0.75)] transition hover:-translate-y-0.5 hover:bg-[#ff7b67]">
                      {roiMessages.savePurchasePrice}
                    </button>
                  </form>
                  <p className="mt-3 text-[11px] leading-5 text-white/55">
                    {item.vehicle.purchasePrice != null && item.vehicle.purchasePrice > 0
                      ? roiMessages.purchasePriceSavedHint
                      : roiMessages.annualizedUnavailable}
                  </p>
                </section>
              </div>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
