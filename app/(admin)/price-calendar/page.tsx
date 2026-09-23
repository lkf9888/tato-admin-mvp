import { VehicleStatus } from "@prisma/client";

import { PricingCalendar } from "@/components/pricing-calendar";
import { requireCurrentWorkspace } from "@/lib/auth";
import { getWorkspaceBookingPolicy } from "@/lib/booking-policy-server";
import { dateToDateOnly, getRentedDayKeys } from "@/lib/direct-booking";
import { getI18n } from "@/lib/i18n-server";
import { prisma } from "@/lib/prisma";
import { loadPriceOverrides } from "@/lib/vehicle-price-overrides";
import { isVehicleBookable, resolveVehicleDailyRate } from "@/lib/vehicle-pricing";

/** The month the grid opens on, clamped to something sane. */
function readMonth(year?: string, month?: string) {
  const now = new Date();
  const parsedYear = Number(year);
  const parsedMonth = Number(month);
  const safeYear =
    Number.isFinite(parsedYear) && parsedYear >= 2020 && parsedYear <= 2100
      ? parsedYear
      : now.getFullYear();
  const safeMonth =
    Number.isFinite(parsedMonth) && parsedMonth >= 1 && parsedMonth <= 12
      ? parsedMonth - 1
      : now.getMonth();
  return { year: safeYear, month: safeMonth };
}

export default async function PriceCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ vehicleId?: string; year?: string; month?: string }>;
}) {
  const workspace = await requireCurrentWorkspace();
  const [query, { locale, messages }, policy, vehicles] = await Promise.all([
    searchParams,
    getI18n(),
    getWorkspaceBookingPolicy(workspace.id),
    prisma.vehicle.findMany({
      where: {
        workspaceId: workspace.id,
        isArchived: false,
        directBookingEnabled: true,
        status: VehicleStatus.available,
      },
      orderBy: { plateNumber: "asc" },
    }),
  ]);

  const copy = messages.pricingCalendarPage;
  const priced = vehicles
    .map((vehicle) => ({ vehicle, rate: resolveVehicleDailyRate(vehicle, policy) }))
    .filter(({ rate }) => isVehicleBookable(rate));

  if (priced.length === 0) {
    return (
      <section className="rounded-lg border border-[color:var(--line)] bg-[rgba(255,255,255,0.88)] px-4 py-5 text-[12px] text-[color:var(--ink-soft)]">
        {copy.emptyFleet}
      </section>
    );
  }

  const selected =
    priced.find(({ vehicle }) => vehicle.id === query.vehicleId) ?? priced[0];
  const { year, month } = readMonth(query.year, query.month);

  const firstDay = new Date(Date.UTC(year, month, 1, 12));
  const lastDay = new Date(Date.UTC(year, month + 1, 0, 12));
  const fromDate = dateToDateOnly(firstDay);
  const toDate = dateToDateOnly(lastDay);

  const [overrides, orders] = await Promise.all([
    loadPriceOverrides({ vehicleId: selected.vehicle.id, fromDate, toDate }),
    prisma.order.findMany({
      where: {
        vehicleId: selected.vehicle.id,
        isArchived: false,
        status: { not: "cancelled" },
        pickupDatetime: { lte: new Date(lastDay.getTime() + 86_400_000) },
        returnDatetime: { gte: firstDay },
      },
      select: { pickupDatetime: true, returnDatetime: true },
    }),
  ]);

  // Booked days are drawn dimmed. Repricing one is allowed -- the trip
  // that already holds it was quoted when it was booked, so a change
  // here only reaches whoever books it next.
  const bookedDates = [
    ...new Set(
      orders.flatMap((order) =>
        getRentedDayKeys(
          dateToDateOnly(order.pickupDatetime),
          dateToDateOnly(order.returnDatetime),
        ),
      ),
    ),
  ];

  return (
    <div className="space-y-3">
      <section className="rounded-lg border border-[color:var(--line)] bg-[linear-gradient(140deg,rgba(255,255,255,0.94),rgba(255,240,231,0.97))] px-4 py-4">
        <p className="text-[10px] uppercase tracking-[0.24em] text-[color:var(--ink-soft)]">
          {copy.kicker}
        </p>
        <h2 className="mt-1 font-serif text-[1.25rem] leading-tight text-[color:var(--ink)]">
          {copy.title}
        </h2>
        <p className="mt-2 max-w-3xl text-[12px] leading-5 text-[color:var(--ink-soft)]">
          {copy.copy}
        </p>
      </section>

      <PricingCalendar
        locale={locale}
        vehicleId={selected.vehicle.id}
        vehicles={priced.map(({ vehicle, rate }) => ({
          id: vehicle.id,
          label: `${vehicle.plateNumber} · ${vehicle.nickname}`,
          baseRate: rate.dailyRate ?? 0,
          rateSource: rate.source ?? "suggested",
        }))}
        overrides={overrides}
        bookedDates={bookedDates}
        year={year}
        month={month}
      />
    </div>
  );
}
