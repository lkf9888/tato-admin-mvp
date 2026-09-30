import { VehicleRoiFleetTable, type FleetRow } from "@/components/vehicle-roi-fleet-table";
import { requireCurrentWorkspace } from "@/lib/auth";
import { getLocaleTag, type Locale } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n-server";
import { prisma } from "@/lib/prisma";
import {
  formatCurrency,
  formatCurrencyCompact,
  formatNumber,
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

function buildMonthLabel(value: Date, locale: Locale) {
  const isChinese = locale === "zh" || locale === "zh-Hant";
  return new Intl.DateTimeFormat(getLocaleTag(locale), {
    month: isChinese ? "numeric" : "short",
    year: "2-digit",
  }).format(value);
}

/**
 * What each car on the fleet has actually earned.
 *
 * The arithmetic is unchanged from the card layout this replaces —
 * current month, a six-month trail, the trailing twelve months, revenue
 * per tracked kilometre, and twelve months over purchase price. What
 * changed is the shape: one row per car instead of one screen per car,
 * so a fleet of a hundred reads as a table rather than a scroll. The
 * numbers are computed here and handed over as plain data, because the
 * search and sort run in the browser.
 */
export default async function VehicleRoiFleetPage() {
  const workspace = await requireCurrentWorkspace();
  const [{ locale, messages }, vehicles] = await Promise.all([
    getI18n(),
    prisma.vehicle.findMany({
      where: { workspaceId: workspace.id },
      include: {
        owner: true,
        orders: {
          where: { isArchived: false },
          orderBy: { pickupDatetime: "desc" },
        },
      },
      orderBy: { plateNumber: "asc" },
    }),
  ]);

  const copy = messages.valuation;
  const now = new Date();
  const currentMonthStart = startOfMonth(now);
  const currentMonthKey = buildMonthKey(currentMonthStart);
  const trailingTwelveMonthStart = addMonths(currentMonthStart, -11);
  const monthTimeline = Array.from({ length: 6 }, (_, index) =>
    addMonths(currentMonthStart, index - 5),
  );
  const monthTimelineKeys = new Set(monthTimeline.map(buildMonthKey));

  let fleetTrackedKm = 0;
  let fleetTrackedRevenue = 0;

  const rows: FleetRow[] = vehicles.map((vehicle) => {
    const activeOrders = vehicle.orders.filter(
      (order) => !order.isArchived && order.status !== "cancelled",
    );
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
      if (pickupMonthKey === currentMonthKey) {
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

    fleetTrackedKm += distanceTrackedKm;
    fleetTrackedRevenue += distanceTrackedRevenue;

    const purchasePrice = vehicle.purchasePrice ?? null;
    return {
      id: vehicle.id,
      plateNumber: vehicle.plateNumber,
      nickname: vehicle.nickname,
      brand: vehicle.brand,
      model: vehicle.model,
      year: vehicle.year,
      ownerName: vehicle.owner?.name ?? null,
      currentMonthRevenue,
      trailingTwelveMonthRevenue,
      distanceTrackedKm,
      revenuePerKm: distanceTrackedKm > 0 ? distanceTrackedRevenue / distanceTrackedKm : null,
      annualizedReturnPct:
        purchasePrice != null && purchasePrice > 0
          ? (trailingTwelveMonthRevenue / purchasePrice) * 100
          : null,
      purchasePrice,
      months: monthTimeline.map((month) => ({
        label: buildMonthLabel(month, locale),
        revenue: monthlyRevenueMap.get(buildMonthKey(month)) ?? 0,
      })),
    };
  });

  const fleetMonthRevenue = rows.reduce((sum, row) => sum + row.currentMonthRevenue, 0);
  const fleetRevenuePerKm = fleetTrackedKm > 0 ? fleetTrackedRevenue / fleetTrackedKm : null;
  const pricedCount = rows.filter((row) => row.purchasePrice != null && row.purchasePrice > 0).length;

  const stats = [
    { label: copy.statMonth, value: formatCurrencyCompact(fleetMonthRevenue, locale), foot: null },
    {
      label: copy.statPerKm,
      // Cents matter here: per-km figures sit well under a dollar.
      value: fleetRevenuePerKm != null ? `${formatCurrency(fleetRevenuePerKm, locale)} / km` : "—",
      foot:
        fleetTrackedKm > 0
          ? copy.statPerKmDistance.replace("{km}", formatNumber(fleetTrackedKm, locale, 0))
          : copy.statPerKmNoDistance,
    },
    { label: copy.statPriced, value: `${pricedCount} / ${rows.length}`, foot: null },
  ];

  return (
    <div className="space-y-3">
      <p className="text-[12px] leading-5 text-[var(--ink-soft)]">{copy.introFleet}</p>

      <dl className="grid grid-cols-3 divide-x divide-[var(--line)] rounded-lg border border-[var(--line)] bg-[var(--surface)]">
        {stats.map((stat) => (
          <div key={stat.label} className="min-w-0 px-3 py-2">
            <dt className="truncate text-[10px] uppercase tracking-[0.14em] text-[var(--ink-soft)]">
              {stat.label}
            </dt>
            <dd className="mt-0.5 truncate text-[15px] font-semibold tabular-nums text-[var(--ink)]">
              {stat.value}
            </dd>
            {stat.foot ? (
              <dd className="truncate text-[10.5px] text-[var(--ink-soft)] tabular-nums">{stat.foot}</dd>
            ) : null}
          </div>
        ))}
      </dl>

      <VehicleRoiFleetTable rows={rows} locale={locale} copy={copy} />
    </div>
  );
}
