import "server-only";

import { OrderStatus, type Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { readDirectBookingPayment } from "@/lib/stripe-refunds";

/**
 * Every deposit the fleet is holding, in one place.
 *
 * Site bookings take the deposit with the rent through Stripe and give
 * it back from there. Deposits taken in person -- cash, e-transfer --
 * left no record of how they came in or where they go back to, so the
 * only reminder of one was memory. This lists both, held and returned,
 * with what is needed to give each back.
 */

/** How long after the return a deposit is due back. The default agreement says two weeks. */
export const DEPOSIT_RETURN_DAYS = 14;

export const DEPOSIT_COLLECTION_METHODS = ["cash", "etransfer", "card", "other"] as const;
export type DepositCollectionMethod = (typeof DEPOSIT_COLLECTION_METHODS)[number];

export function isDepositCollectionMethod(value: unknown): value is DepositCollectionMethod {
  return typeof value === "string" && (DEPOSIT_COLLECTION_METHODS as readonly string[]).includes(value);
}

export type DepositRow = {
  orderId: string;
  renterName: string;
  renterPhone: string | null;
  renterEmail: string | null;
  vehicleId: string;
  vehicleLabel: string;
  plateNumber: string;
  pickupAt: Date;
  returnAt: Date;
  amount: number;
  /** Paid through the site: refunded through Stripe. */
  viaStripe: boolean;
  collectedVia: DepositCollectionMethod | "stripe" | null;
  collectedAt: Date | null;
  refundTo: string | null;
  dueBy: Date;
  settled: { at: Date; refunded: number; note: string | null } | null;
};

const ORDER_SELECT = {
  id: true,
  renterName: true,
  renterPhone: true,
  pickupDatetime: true,
  returnDatetime: true,
  depositAmount: true,
  sourceMetadata: true,
  createdAt: true,
  depositCollectedVia: true,
  depositCollectedAt: true,
  depositRefundTo: true,
  depositSettledAt: true,
  depositRefundedAmount: true,
  depositSettlementNote: true,
  vehicle: { select: { id: true, brand: true, model: true, year: true, plateNumber: true, nickname: true } },
} satisfies Prisma.OrderSelect;

type OrderForDeposit = Prisma.OrderGetPayload<{ select: typeof ORDER_SELECT }>;

function toRow(order: OrderForDeposit): DepositRow {
  const payment = readDirectBookingPayment(order.sourceMetadata);
  const viaStripe = payment.isDirectBooking && Boolean(payment.paymentIntentId);
  const vehicle = order.vehicle;
  return {
    orderId: order.id,
    renterName: order.renterName,
    renterPhone: order.renterPhone,
    renterEmail: payment.renterEmail,
    vehicleId: vehicle.id,
    vehicleLabel: vehicle.nickname?.trim() || `${vehicle.brand} ${vehicle.model} ${vehicle.year}`,
    plateNumber: vehicle.plateNumber,
    pickupAt: order.pickupDatetime,
    returnAt: order.returnDatetime,
    amount: order.depositAmount ?? 0,
    viaStripe,
    collectedVia: viaStripe
      ? "stripe"
      : isDepositCollectionMethod(order.depositCollectedVia)
        ? order.depositCollectedVia
        : null,
    // A site booking's deposit came in with the payment.
    collectedAt: viaStripe ? order.createdAt : order.depositCollectedAt,
    refundTo: viaStripe ? null : order.depositRefundTo,
    dueBy: new Date(order.returnDatetime.getTime() + DEPOSIT_RETURN_DAYS * 86_400_000),
    settled: order.depositSettledAt
      ? {
          at: order.depositSettledAt,
          refunded: order.depositRefundedAmount ?? 0,
          note: order.depositSettlementNote,
        }
      : null,
  };
}

export async function listDeposits(input: {
  workspaceId: string;
  history: boolean;
  query?: string;
  vehicleId?: string;
}) {
  const query = input.query?.trim();
  const where: Prisma.OrderWhereInput = {
    workspaceId: input.workspaceId,
    isArchived: false,
    // A cancellation refunds the deposit with everything else.
    status: { not: OrderStatus.cancelled },
    depositAmount: { gt: 0 },
    depositSettledAt: input.history ? { not: null } : null,
    ...(input.vehicleId ? { vehicleId: input.vehicleId } : {}),
    ...(query
      ? {
          OR: [
            { renterName: { contains: query } },
            { renterPhone: { contains: query } },
            // The renter's email lives in the booking's metadata.
            { sourceMetadata: { contains: query } },
            { depositRefundTo: { contains: query } },
            { depositSettlementNote: { contains: query } },
            { vehicle: { plateNumber: { contains: query } } },
            { vehicle: { nickname: { contains: query } } },
          ],
        }
      : {}),
  };
  const orders = await prisma.order.findMany({
    where,
    select: ORDER_SELECT,
    orderBy: input.history ? { depositSettledAt: "desc" } : { returnDatetime: "asc" },
    take: input.history ? 100 : 300,
  });
  return orders.map(toRow);
}

/** How many deposits are held, for the tab badge. */
export function countHeldDeposits(workspaceId: string) {
  return prisma.order.count({
    where: {
      workspaceId,
      isArchived: false,
      status: { not: OrderStatus.cancelled },
      depositAmount: { gt: 0 },
      depositSettledAt: null,
    },
  });
}
