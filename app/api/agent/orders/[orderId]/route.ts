import { authenticateAgent } from "@/lib/agent-auth";
import { corsPreflight, withCors } from "@/lib/agent-cors";
import { iso, money } from "@/lib/agent-read";
import { getOrderFeeLines } from "@/lib/ledger-policy";
import { resolveOrderCleaningFees } from "@/lib/owner-commission";
import { prisma } from "@/lib/prisma";
import { getOrderNetEarning } from "@/lib/utils";

export const runtime = "nodejs";

type Params = Promise<{ orderId: string }>;

/**
 * One trip, in full.
 *
 * The list endpoint answers "which trips"; this answers "what is this
 * trip made of". The difference that matters is `charges`: Turo bundles
 * up to thirty separate columns into the single earnings figure, and
 * without them "why is this trip $377" has no answer an automation can
 * reach.
 *
 * Archived trips are returned here. A deleted order in TATO is
 * archived rather than removed, and an agent that already holds an id
 * is asking about a specific trip -- answering NOT_FOUND for one that
 * demonstrably existed would send it looking for a bug.
 */
export async function GET(request: Request, { params }: { params: Params }) {
  const agent = await authenticateAgent(request, "read");
  if (!agent) return withCors({ error: "UNAUTHORIZED" }, { status: 401 });

  const { orderId } = await params;
  const order = await prisma.order.findFirst({
    where: { id: orderId, workspaceId: agent.workspaceId },
    include: {
      vehicle: {
        include: {
          owner: { select: { id: true, name: true } },
          cleaningFeeRules: { orderBy: { effectiveFrom: "desc" } },
        },
      },
      ownerLedgerItems: { orderBy: { occurredAt: "asc" } },
    },
  });

  if (!order) return withCors({ error: "NOT_FOUND" }, { status: 404 });

  const cleaningFees = resolveOrderCleaningFees(order);

  return withCors({
    id: order.id,
    source: order.source,
    status: order.status,
    isArchived: order.isArchived,
    externalOrderId: order.externalOrderId,
    renterName: order.renterName,
    renterPhone: order.renterPhone,
    pickupDatetime: iso(order.pickupDatetime),
    returnDatetime: iso(order.returnDatetime),
    pickupLocation: order.pickupLocation,
    returnLocation: order.returnLocation,
    netEarning: money(getOrderNetEarning(order.sourceMetadata, order.totalPrice)),
    depositAmount: money(order.depositAmount),
    paymentMethod: order.paymentMethod,
    contractNumber: order.contractNumber,
    hasConflict: order.hasConflict,
    ownerLedgerSyncedAt: iso(order.ownerLedgerSyncedAt),
    notes: order.notes,
    createdBy: order.createdBy,
    createdAt: iso(order.createdAt),
    updatedAt: iso(order.updatedAt),
    vehicle: {
      id: order.vehicle.id,
      plateNumber: order.vehicle.plateNumber,
      nickname: order.vehicle.nickname,
      brand: order.vehicle.brand,
      model: order.vehicle.model,
      year: order.vehicle.year,
      owner: order.vehicle.owner
        ? { id: order.vehicle.owner.id, name: order.vehicle.owner.name }
        : null,
    },
    /** What this trip is charged for cleaning, and what the car costs
     *  today. They differ whenever the price changed after the trip
     *  started, and the trip keeps the price it was booked under. */
    cleaningFeeOnTrip: money(cleaningFees.cleaningFeeOnTrip),
    vehicleCleaningFeeToday: money(cleaningFees.cleaningFee),
    /** Every charge beyond the rent, as Turo's export wrote it. Empty
     *  for offline orders, which have a price typed in directly rather
     *  than assembled from components. */
    charges: getOrderFeeLines(order.sourceMetadata).map((line) => ({
      column: line.column,
      group: line.group,
      amount: money(line.amount),
      sign: line.sign,
    })),
    /** What this trip put on the owner's statement, if anything. */
    ownerLedgerItems: order.ownerLedgerItems.map((item) => ({
      id: item.id,
      kind: item.kind,
      amount: money(item.amount),
      occurredAt: iso(item.occurredAt),
      note: item.note,
      isAuto: item.isAuto,
    })),
  });
}

export function OPTIONS() {
  return corsPreflight();
}
