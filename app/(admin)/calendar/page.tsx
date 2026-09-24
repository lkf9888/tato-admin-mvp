import { CalendarView } from "@/components/calendar-view";
import { getWorkspaceBookingPolicy } from "@/lib/booking-policy-server";
import { getRateSeasonality } from "@/lib/rental-estimate/rate-seasonality-server";
import { resolveVehicleDailyRate } from "@/lib/vehicle-pricing";
import { dateToDateOnly } from "@/lib/direct-booking";
import { MobileCalendarSwitch } from "@/components/mobile-calendar-switch";
import { MobileScheduleList } from "@/components/mobile-schedule-list";
import { requireCurrentWorkspace } from "@/lib/auth";
import { getI18n } from "@/lib/i18n-server";
import { prisma } from "@/lib/prisma";
import {
  CALENDAR_ORDER_INCLUDE,
  calendarOrderWhere,
  toCalendarOrderPayload,
} from "@/lib/calendar-orders";
import { initialChunkIndexes, spanForChunks } from "@/lib/calendar-window";

/**
 * The calendar no longer decides in advance how much history it will
 * ever show.
 *
 * It used to load every non-cancelled order the workspace had
 * imported. Measured on production: 5,013 orders, 14.9 MB of HTML,
 * 9,998 script tags -- Next streams the RSC payload in chunks and
 * emits one `<script>` per chunk -- and three seconds of server time.
 * The fix was a fixed three-months-either-side window, which kept the
 * page fast at the cost of making anything older simply absent.
 *
 * Now the server renders the chunks around today so the grid opens
 * with bars already on it, and the grid fetches further chunks from
 * /api/calendar/orders as you scroll toward them. The payload is the
 * same size as the fixed window was; the difference is that scrolling
 * past its edge now loads more instead of showing nothing.
 */
function initialWindow() {
  const indexes = initialChunkIndexes(new Date());
  return { ...spanForChunks(indexes), indexes };
}

export default async function CalendarPage() {
  const workspace = await requireCurrentWorkspace();
  const { from, to, indexes } = initialWindow();
  const [
    { locale, messages },
    vehicles,
    bookingPolicy,
    seasonality,
    priceOverrideRows,
    owners,
    orders,
  ] = await Promise.all([
    getI18n(),
    prisma.vehicle.findMany({
      where: { workspaceId: workspace.id },
      include: { owner: true },
      orderBy: { plateNumber: "asc" },
    }),
    getWorkspaceBookingPolicy(workspace.id),
    getRateSeasonality(workspace.id),
    // Sparse by nature: only days somebody priced by hand have rows,
    // so this is small even for a fleet that has been running years.
    prisma.vehiclePriceOverride.findMany({
      where: { vehicle: { workspaceId: workspace.id } },
      select: { vehicleId: true, date: true, price: true },
    }),
    prisma.owner.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { name: "asc" },
    }),
    prisma.order.findMany({
      where: calendarOrderWhere(workspace.id, from, to),
      include: CALENDAR_ORDER_INCLUDE,
      orderBy: { pickupDatetime: "asc" },
    }),
  ]);

  // The 1400-line CalendarView is built around a horizontal-scroll
  // 2D timeline that requires both axes to be useful — perfect for a
  // 1280px laptop, hostile on a 375px phone. Mobile gets a vertical,
  // time-bucketed list instead (`MobileScheduleList`); desktop keeps
  // the timeline. Both render the same data, so a host who pulls up
  // the page on a phone sees the same source of truth as on the
  // browser, just laid out for their thumb.
  // The mobile list buckets into today / tomorrow / this week / later,
  // and its own note says it assumes an active fleet rarely books more
  // than ~30 days out. This fleet books six months out, so "later" was
  // catching ~900 trips: a phone downloaded every one of them, then
  // rendered a list nobody scrolls to the end of. Thirty days matches
  // what the component was written for, and anything beyond it is a
  // lookup that /orders answers better.
  const scheduleHorizon = new Date();
  scheduleHorizon.setDate(scheduleHorizon.getDate() + 30);

  const scheduleOrders = orders
    // Cancelled trips reach this page now (the grid draws them as a
    // thin strip so a cancellation is visible rather than absent), but
    // the phone's list is "what is happening", and a cancelled trip is
    // not happening.
    .filter(
      (order) => order.status !== "cancelled" && order.pickupDatetime <= scheduleHorizon,
    )
    .map((order) => ({
    id: order.id,
    vehicleName: order.vehicle.nickname,
    vehiclePlateNumber: order.vehicle.plateNumber,
    renterName: order.renterName,
    ownerName: order.vehicle.owner?.name ?? null,
    pickupDatetime: order.pickupDatetime,
    returnDatetime: order.returnDatetime,
    status: order.status,
    source: order.source,
    hasConflict: order.hasConflict,
    }));

  // Built once, rendered in two places -- the phone's switch and the
  // desktop pane show the same component, and duplicating the props
  // would double the payload for a view only one of them displays.
  const vehicleRates = new Map(
    vehicles.map((vehicle) => [vehicle.id, resolveVehicleDailyRate(vehicle, bookingPolicy)]),
  );
  const priceOverrides: Record<string, Record<string, number>> = {};
  for (const row of priceOverrideRows) {
    const key = dateToDateOnly(row.date);
    priceOverrides[row.vehicleId] = { ...(priceOverrides[row.vehicleId] ?? {}), [key]: row.price };
  }

  const calendarView = (
    <CalendarView
      locale={locale}
      pricing={{
        seasonality,
        overrides: priceOverrides,
        rates: Object.fromEntries(
          [...vehicleRates].map(([id, rate]) => [
            id,
            { baseRate: rate.dailyRate ?? 0, source: rate.source ?? "suggested" },
          ]),
        ),
      }}
      vehicleOptions={vehicles.map((vehicle) => ({
        id: vehicle.id,
        label: vehicle.nickname,
        plateNumber: vehicle.plateNumber,
        secondaryLabel: `${vehicle.brand} ${vehicle.model} ${vehicle.year}`,
        ownerId: vehicle.ownerId,
        ownerName: vehicle.owner?.name,
        // Either identifier means somebody has actually connected this
        // car to a Turo listing. Having Turo orders does not.
        turoLinked: Boolean(vehicle.turoVehicleCode || vehicle.turoListingName),
        editVehicle: {
          id: vehicle.id,
          ownerId: vehicle.ownerId,
          plateNumber: vehicle.plateNumber,
          nickname: vehicle.nickname,
          brand: vehicle.brand,
          model: vehicle.model,
          year: vehicle.year,
          vin: vehicle.vin,
          status: vehicle.status,
          isArchived: vehicle.isArchived,
          turoListingName: vehicle.turoListingName,
          turoVehicleCode: vehicle.turoVehicleCode,
          purchasePrice: vehicle.purchasePrice,
          ownerCommissionRate: vehicle.ownerCommissionRate,
          cleaningFee: vehicle.cleaningFee,
          pickupPassword: vehicle.pickupPassword,
          bookingTaxName: vehicle.bookingTaxName,
          bookingTaxRate: vehicle.bookingTaxRate,
          notes: vehicle.notes,
        },
      }))}
      ownerOptions={owners.map((owner) => ({
        id: owner.id,
        label: owner.name,
      }))}
      orders={orders.map(toCalendarOrderPayload)}
      loadedChunkIndexes={indexes}
    />
  );

  return (
    // Both views on a phone, with the operator choosing. The list
    // answers "what is happening today"; the timeline answers "is this
    // car free next Tuesday", and only the second shows the shape of a
    // week. Choosing for them left the second question with no answer
    // on a phone at all.
    <MobileCalendarSwitch
      listLabel={messages.calendar.mobile.viewList}
      timelineLabel={messages.calendar.mobile.viewTimeline}
      list={
        <MobileScheduleList
          orders={scheduleOrders}
          locale={locale}
          labels={messages.calendar.mobile}
        />
      }
      timeline={calendarView}
    />
  );
}
