import { LedgerShareTarget } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAccessContext } from "@/lib/auth";
import {
  applyLineAmounts,
  CLEANING_LINE,
  FEE_CATALOGUE,
  getOrderFeeLines,
  parseFeeShareOverrides,
  resolveFeeTarget,
  resolveWorkspaceLedgerPolicy,
  TRIP_AMOUNT_LINE,
  type OrderLineAdjustment,
} from "@/lib/ledger-policy";
import { resolveCleaningFee } from "@/lib/owner-commission";
import { planOrderOwnerShare, syncOrderOwnerLedger } from "@/lib/owner-ledger";
import { logActivity } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import { getOrderNetEarning, parseImportedOrderMetadata, parseNumberValue } from "@/lib/utils";

type Params = Promise<{ orderId: string }>;

/**
 * One trip's statement, as the order panel draws it, and the trip's own
 * corrections to it: an amount typed over a CSV line, and whether a line
 * counts toward the owner's share on this trip. Corrections live in
 * OrderLedgerAdjustment, apart from the order, because the daily CSV
 * re-import rewrites the order's amounts and must not undo them.
 *
 * The owner's figure comes from planOrderOwnerShare -- the function the
 * owner ledger is written with -- so the panel cannot show a number the
 * statement would not. A save on a trip already shared with its owner
 * resyncs that trip's ledger rows at once.
 */

const LINE_KEYS = new Set([...FEE_CATALOGUE.map((fee) => fee.column), TRIP_AMOUNT_LINE, CLEANING_LINE]);

const bodySchema = z.object({
  line: z.string().refine((line) => LINE_KEYS.has(line)),
  /** Only for CSV lines: the amount as typed, without its sign. null
   *  goes back to the CSV's. */
  amount: z.number().finite().nonnegative().max(1_000_000).nullable().optional(),
  /** Whether the line counts toward the owner's share on this trip. */
  ownerShare: z.boolean().optional(),
});

async function loadOrder(orderId: string) {
  const context = await requireAccessContext();
  const order = await prisma.order.findFirst({
    where: {
      id: orderId,
      workspaceId: context.workspace.id,
      isArchived: false,
      ...(context.vehicleIds ? { vehicleId: { in: context.vehicleIds } } : {}),
    },
    include: { vehicle: { include: { owner: true } }, workspace: true },
  });
  return { context, order };
}

type LoadedOrder = NonNullable<Awaited<ReturnType<typeof loadOrder>>["order"]>;

async function statement(order: LoadedOrder) {
  const adjustments: OrderLineAdjustment[] = await prisma.orderLedgerAdjustment.findMany({
    where: { orderId: order.id },
    select: { line: true, amount: true, ownerShare: true },
  });
  const byLine = new Map(adjustments.map((adjustment) => [adjustment.line, adjustment]));
  const policy = resolveWorkspaceLedgerPolicy(order.workspace);
  const ownerOverrides = parseFeeShareOverrides(order.vehicle.owner?.feeShareOverrides);
  const corrected = applyLineAmounts(order.sourceMetadata, adjustments);
  const reported = getOrderNetEarning(order.sourceMetadata, order.totalPrice);
  const originals = parseImportedOrderMetadata(order.sourceMetadata)?.financials ?? {};

  const share = (line: string, fallback: boolean) => {
    const own = byLine.get(line)?.ownerShare;
    return { ownerShare: own ?? fallback, ownerShareDefault: fallback };
  };

  const lines = getOrderFeeLines(corrected.sourceMetadata).map((fee) => {
    const original = parseNumberValue(originals[fee.column]) ?? 0;
    const amount = fee.sign === "debit" ? -Math.abs(fee.amount) : fee.amount;
    return {
      line: fee.column,
      amount,
      original: fee.sign === "debit" ? -Math.abs(original) : original,
      adjusted: byLine.get(fee.column)?.amount != null,
      ...share(fee.column, resolveFeeTarget(fee.column, policy, ownerOverrides) === LedgerShareTarget.OWNER),
    };
  });

  const cleaningRules = await prisma.vehicleCleaningFeeRule.findMany({
    where: { vehicleId: order.vehicleId },
    orderBy: { effectiveFrom: "desc" },
    select: { id: true, amount: true, effectiveFrom: true },
  });
  const cleaningFee = Math.round(
    resolveCleaningFee(cleaningRules, order.pickupDatetime, order.vehicle.cleaningFee).amount * 100,
  ) / 100;

  const plan = order.vehicle.ownerId ? await planOrderOwnerShare(order.id) : null;

  return {
    owner: order.vehicle.owner ? { id: order.vehicle.owner.id, name: order.vehicle.owner.name } : null,
    /** The trip's earnings with its own corrections. */
    tripNet: reported == null ? null : Math.round((reported + corrected.delta) * 100) / 100,
    lines,
    amountLine: share(TRIP_AMOUNT_LINE, true),
    cleaning: { amount: cleaningFee, ...share(CLEANING_LINE, true) },
    ownerShare: plan
      ? {
          ownerNet: plan.ownerNet,
          ownerRevenue: plan.ownerRevenue,
          commission: plan.commission,
          commissionRate: plan.commissionRate,
          cleaningFee: plan.cleaningFee,
        }
      : null,
  };
}

export async function GET(_request: Request, { params }: { params: Params }) {
  const { orderId } = await params;
  const { order } = await loadOrder(orderId);
  if (!order) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  return NextResponse.json(await statement(order));
}

export async function PUT(request: Request, { params }: { params: Params }) {
  const { orderId } = await params;
  const { context, order } = await loadOrder(orderId);
  if (!order) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID" }, { status: 400 });
  const { line } = parsed.data;
  const fee = FEE_CATALOGUE.find((definition) => definition.column === line);
  if (parsed.data.amount !== undefined && !fee) {
    // The trip's own amount and the cleaning fee have their own editors.
    return NextResponse.json({ error: "NOT_EDITABLE" }, { status: 400 });
  }

  const existing = await prisma.orderLedgerAdjustment.findUnique({
    where: { orderId_line: { orderId, line } },
  });
  let amount = existing?.amount ?? null;
  let ownerShare = existing?.ownerShare ?? null;

  if (parsed.data.amount !== undefined) {
    if (parsed.data.amount === null) {
      amount = null;
    } else {
      // The sign is the line's, not the typist's: a discount or a
      // withheld tax stays a deduction however it was typed.
      const original = parseNumberValue(parseImportedOrderMetadata(order.sourceMetadata)?.financials?.[line]) ?? 0;
      const negative = fee?.sign === "debit" || original < 0;
      amount = Math.round((negative ? -1 : 1) * parsed.data.amount * 100) / 100;
      if (Math.abs(amount - original) < 0.005) amount = null;
    }
  }
  if (parsed.data.ownerShare !== undefined) {
    // Stored only where it differs from the owner's rules, so changing
    // a rule later still reaches every trip nobody ticked by hand.
    const current = await statement(order);
    const fallback =
      line === TRIP_AMOUNT_LINE
        ? current.amountLine.ownerShareDefault
        : line === CLEANING_LINE
          ? current.cleaning.ownerShareDefault
          : current.lines.find((item) => item.line === line)?.ownerShareDefault ?? true;
    ownerShare = parsed.data.ownerShare === fallback ? null : parsed.data.ownerShare;
  }

  if (amount == null && ownerShare == null) {
    if (existing) await prisma.orderLedgerAdjustment.delete({ where: { id: existing.id } });
  } else {
    await prisma.orderLedgerAdjustment.upsert({
      where: { orderId_line: { orderId, line } },
      create: {
        workspaceId: order.workspaceId ?? context.workspace.id,
        orderId,
        line,
        amount,
        ownerShare,
        updatedBy: context.user.name,
      },
      update: { amount, ownerShare, updatedBy: context.user.name },
    });
  }

  if (order.ownerLedgerSyncedAt) await syncOrderOwnerLedger(orderId);

  await logActivity({
    workspaceId: context.workspace.id,
    actor: context.user.name,
    action: "order_ledger_adjusted",
    entityType: "Order",
    entityId: orderId,
    metadata: { line, amount, ownerShare },
  });

  return NextResponse.json(await statement(order));
}
