import { Prisma } from "@prisma/client";

import { getOrderFeeLines } from "@/lib/ledger-policy";
import { resolveOrderCleaningFees } from "@/lib/owner-commission";
import { getDisplayOrderNote, getOrderNetEarning } from "@/lib/utils";

/**
 * The one place that says what an order looks like to the calendar.
 *
 * The page used to build this shape inline. Now that the grid fetches
 * further dates as you scroll, the same shape has to come out of an
 * API route as well -- and two hand-written copies of a 25-field
 * mapping drift within a release. When they drift, an order opened
 * from a scrolled-to date shows different fields from the same order
 * opened on first paint, which reads as data loss rather than as a
 * mapping bug.
 */
export const CALENDAR_ORDER_INCLUDE = {
  vehicle: {
    include: {
      owner: true,
      // Needed to resolve this order's cleaning fee the same way the
      // save endpoint does -- without it the detail panel always
      // showed the fee box empty, whatever had been saved.
      cleaningFeeRules: { orderBy: { effectiveFrom: "desc" } },
    },
  },
} satisfies Prisma.OrderInclude;

type CalendarOrderRow = Prisma.OrderGetPayload<{
  include: typeof CALENDAR_ORDER_INCLUDE;
}>;

/** Matches `EditableOrder` in components/order-detail-modal.tsx. */
export type CalendarOrderPayload = {
  id: string;
  source: "turo" | "offline";
  status: "booked" | "ongoing" | "completed" | "cancelled";
  hasConflict: boolean;
  vehicleId: string;
  vehicleName: string;
  vehiclePlateNumber?: string | null;
  ownerId?: string | null;
  ownerName?: string | null;
  renterName: string;
  renterPhone?: string | null;
  pickupDatetime: string;
  returnDatetime: string;
  totalPrice?: number | null;
  depositAmount?: number | null;
  pickupLocation?: string | null;
  returnLocation?: string | null;
  paymentMethod?: string | null;
  contractNumber?: string | null;
  notes?: string | null;
  createdBy?: string | null;
  externalOrderId?: string | null;
  ownerLedgerSyncedAt?: string | null;
  cleaningFee?: number | null;
  cleaningFeeOnTrip?: number | null;
  feeLines?: Array<{ column: string; group: string; amount: number; sign: string }>;
};

export function toCalendarOrderPayload(order: CalendarOrderRow): CalendarOrderPayload {
  return {
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
  };
}

/**
 * Which orders the calendar draws for a date window.
 *
 * Overlap, not containment: a trip that started before the window and
 * ends inside it is still on the calendar, and a long rental spanning
 * the whole window must not vanish because neither of its endpoints
 * falls in range.
 *
 * Cancelled orders are deliberately included. The grid draws them as a
 * thin strip rather than a bar -- a cancellation you cannot see is a
 * cancellation you cannot check -- and the client decides what to do
 * with them. Archived ones are the ones that are really gone.
 */
export function calendarOrderWhere(
  workspaceId: string,
  from: Date,
  to: Date,
): Prisma.OrderWhereInput {
  return {
    workspaceId,
    isArchived: false,
    pickupDatetime: { lte: to },
    returnDatetime: { gte: from },
  };
}
