import { CalendarView } from "@/components/calendar-view";
import { MobileCalendarSwitch } from "@/components/mobile-calendar-switch";
import { MobileScheduleList } from "@/components/mobile-schedule-list";
import { requireCurrentWorkspace } from "@/lib/auth";
import { getI18n } from "@/lib/i18n-server";
import { prisma } from "@/lib/prisma";
import { getOrderFeeLines } from "@/lib/ledger-policy";
import { resolveOrderCleaningFees } from "@/lib/owner-commission";
import { getDisplayOrderNote, getOrderNetEarning } from "@/lib/utils";

/**
 * How far either side of today the calendar loads.
 *
 * It used to load every non-cancelled order the workspace had ever
 * imported. Measured on production: 5,013 orders, 14.9 MB of HTML,
 * 9,998 script tags -- Next streams the RSC payload in chunks and
 * emits one `<script>` per chunk -- and three seconds of server time.
 * On a laptop that reads as "a bit slow". On a phone over cellular it
 * is tens of seconds and tens of megabytes of the operator's data, for
 * a screen that shows a few weeks.
 *
 * Nine months of window covers what this page is for: what is out now,
 * what is coming, and enough of the recent past to reconcile against.
 * Anything older is a lookup, and /orders does lookups properly with
 * search and filters.
 */
const CALENDAR_PAST_MONTHS = 3;
const CALENDAR_FUTURE_MONTHS = 3;

function calendarWindow() {
  const from = new Date();
  from.setMonth(from.getMonth() - CALENDAR_PAST_MONTHS);
  from.setHours(0, 0, 0, 0);

  const to = new Date();
  to.setMonth(to.getMonth() + CALENDAR_FUTURE_MONTHS);
  to.setHours(23, 59, 59, 999);

  return { from, to };
}

export default async function CalendarPage() {
  const workspace = await requireCurrentWorkspace();
  const { from, to } = calendarWindow();
  const [{ locale, messages }, vehicles, owners, orders] = await Promise.all([
    getI18n(),
    prisma.vehicle.findMany({
      where: { workspaceId: workspace.id },
      include: { owner: true },
      orderBy: { plateNumber: "asc" },
    }),
    prisma.owner.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { name: "asc" },
    }),
    prisma.order.findMany({
      where: {
        workspaceId: workspace.id,
        isArchived: false,
        status: {
          not: "cancelled",
        },
        // Overlap, not containment: a trip that started before the
        // window and ends inside it is still on the calendar, and a
        // long rental spanning the whole window must not vanish
        // because neither of its endpoints falls in range.
        pickupDatetime: { lte: to },
        returnDatetime: { gte: from },
      },
      include: {
        vehicle: {
          include: {
            owner: true,
            // Needed to resolve this order's cleaning fee the same
            // way the save endpoint does -- without it, the panel
            // opened from the calendar always showed the fee box
            // empty, whatever had actually been saved.
            cleaningFeeRules: { orderBy: { effectiveFrom: "desc" } },
          },
        },
      },
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
    .filter((order) => order.pickupDatetime <= scheduleHorizon)
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
  const calendarView = (
    <CalendarView
      locale={locale}
      vehicleOptions={vehicles.map((vehicle) => ({
        id: vehicle.id,
        label: vehicle.nickname,
        plateNumber: vehicle.plateNumber,
        secondaryLabel: `${vehicle.brand} ${vehicle.model} ${vehicle.year}`,
        ownerId: vehicle.ownerId,
        ownerName: vehicle.owner?.name,
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
      orders={orders.map((order) => ({
        id: order.id,
        source: order.source,
        status: order.status,
        hasConflict: order.hasConflict,
        vehicleId: order.vehicleId,
        vehicleName: order.vehicle.nickname,
        vehiclePlateNumber: order.vehicle.plateNumber,
        ownerId: order.vehicle.ownerId,
        ownerName: order.vehicle.owner?.name,
        renterName: order.renterName,
        renterPhone: order.renterPhone,
        pickupDatetime: order.pickupDatetime.toISOString(),
        returnDatetime: order.returnDatetime.toISOString(),
        totalPrice: getOrderNetEarning(order.sourceMetadata, order.totalPrice),
        depositAmount: order.depositAmount,
        pickupLocation: order.pickupLocation,
        returnLocation: order.returnLocation,
        paymentMethod: order.paymentMethod,
        contractNumber: order.contractNumber,
        notes: getDisplayOrderNote(order.notes, order.source),
        createdBy: order.createdBy,
        externalOrderId: order.externalOrderId,
        ownerLedgerSyncedAt: order.ownerLedgerSyncedAt?.toISOString() ?? null,
        ...resolveOrderCleaningFees(order),
        feeLines: getOrderFeeLines(order.sourceMetadata),
      }))}
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
