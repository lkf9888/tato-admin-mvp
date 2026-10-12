import { DYNAMIC_PRICING_ACTOR } from "@/lib/vehicle-pricing-dynamic";
import { CalendarView } from "@/components/calendar-view";
import { getWorkspaceBookingPolicy } from "@/lib/booking-policy-server";
import { getRateSeasonality } from "@/lib/rental-estimate/rate-seasonality-server";
import { resolveVehicleDailyRate } from "@/lib/vehicle-pricing";
import { dateToDateOnly } from "@/lib/direct-booking";
import { MobileCalendarSwitch } from "@/components/mobile-calendar-switch";
import { CalendarAgendaList } from "@/components/calendar-agenda-list";
import { userRole } from "@/lib/access";
import { requireAccessContext } from "@/lib/auth";
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
  const { user, workspace, vehicleIds } = await requireAccessContext();
  // A viewer can open the calendar but every save is refused for them,
  // so they get the read-only grid rather than buttons that fail.
  const viewOnly = userRole(user) === "VIEWER";
  // A car-limited member sees their cars, their trips and those cars' owners.
  const carFilter = vehicleIds ? { id: { in: vehicleIds } } : {};
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
      where: { workspaceId: workspace.id, ...carFilter },
      include: { owner: true },
      orderBy: { plateNumber: "asc" },
    }),
    getWorkspaceBookingPolicy(workspace.id),
    getRateSeasonality(workspace.id),
    // Sparse by nature: only days somebody priced by hand have rows,
    // so this is small even for a fleet that has been running years.
    prisma.vehiclePriceOverride.findMany({
      where: { vehicle: { workspaceId: workspace.id, ...carFilter } },
      select: { vehicleId: true, date: true, price: true, createdBy: true },
    }),
    prisma.owner.findMany({
      where: { workspaceId: workspace.id, ...(vehicleIds ? { vehicles: { some: { id: { in: vehicleIds } } } } : {}) },
      orderBy: { name: "asc" },
    }),
    prisma.order.findMany({
      where: calendarOrderWhere(workspace.id, from, to, vehicleIds),
      include: CALENDAR_ORDER_INCLUDE,
      orderBy: { pickupDatetime: "asc" },
    }),
  ]);

  // A phone shows the timeline or a list (CalendarAgendaList); a
  // desktop always the timeline. The list covers one week -- the next
  // seven days' handovers and the trips running through them -- which
  // keeps it to a few dozen rows; anything further out is a lookup
  // that /orders answers better.
  // The phone's list: the next week's handovers and the trips running
  // through it, each with who is assigned to its pickup and return.
  const agendaStart = new Date();
  agendaStart.setHours(0, 0, 0, 0);
  const agendaEnd = new Date(agendaStart);
  agendaEnd.setDate(agendaEnd.getDate() + 7);
  const agendaRows = orders.filter(
    (order) =>
      order.status !== "cancelled" && order.pickupDatetime < agendaEnd && order.returnDatetime >= agendaStart,
  );
  const handoverTasks = await prisma.staffTask.findMany({
    where: {
      workspaceId: workspace.id,
      orderId: { in: agendaRows.map((order) => order.id) },
      category: { in: ["order_pickup", "order_return"] },
      status: { not: "cancelled" },
      parentTaskId: null,
    },
    select: { orderId: true, category: true, staff: { select: { name: true } } },
  });
  const staffFor = (orderId: string, category: string) =>
    handoverTasks.find((task) => task.orderId === orderId && task.category === category)?.staff?.name ?? null;
  const agendaOrders = agendaRows.map((order) => ({
    order: toCalendarOrderPayload(order),
    pickupStaff: staffFor(order.id, "order_pickup"),
    returnStaff: staffFor(order.id, "order_return"),
  }));

  // Built once, rendered in two places -- the phone's switch and the
  // desktop pane show the same component, and duplicating the props
  // would double the payload for a view only one of them displays.
  const vehicleRates = new Map(
    vehicles.map((vehicle) => [vehicle.id, resolveVehicleDailyRate(vehicle, bookingPolicy)]),
  );
  const priceOverrides: Record<string, Record<string, number>> = {};
  // Days dynamic pricing set rather than a person, drawn apart from them.
  const dynamicDays: Record<string, string[]> = {};
  for (const row of priceOverrideRows) {
    const key = dateToDateOnly(row.date);
    priceOverrides[row.vehicleId] = { ...(priceOverrides[row.vehicleId] ?? {}), [key]: row.price };
    if (row.createdBy === DYNAMIC_PRICING_ACTOR) {
      (dynamicDays[row.vehicleId] ??= []).push(key);
    }
  }

  const calendarView = (
    <CalendarView
      locale={locale}
      limitedToVehicles={Boolean(vehicleIds)}
      readOnly={viewOnly}
      pricing={{
        seasonality,
        overrides: priceOverrides,
        dynamicDays,
        rates: Object.fromEntries(
          [...vehicleRates].map(([id, rate]) => [
            id,
            {
              baseRate: rate.dailyRate ?? 0,
              source: rate.source ?? "suggested",
              // Only cars renters can book have a price worth showing.
              bookable: Boolean(vehicles.find((vehicle) => vehicle.id === id)?.directBookingEnabled),
            },
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
        directBooking: vehicle.directBookingEnabled,
        archived: vehicle.isArchived,
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
          turoPlanPercent: vehicle.turoPlanPercent,
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
        <CalendarAgendaList
          orders={agendaOrders}
          locale={locale}
          readOnly={viewOnly}
          vehicleOptions={vehicles.map((vehicle) => ({
            id: vehicle.id,
            label: vehicle.nickname,
            plateNumber: vehicle.plateNumber,
            secondaryLabel: `${vehicle.brand} ${vehicle.model} ${vehicle.year}`,
            ownerId: vehicle.ownerId,
            ownerName: vehicle.owner?.name,
          }))}
        />
      }
      timeline={calendarView}
    />
  );
}
