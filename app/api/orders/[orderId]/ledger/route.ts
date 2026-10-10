import { randomBytes } from "node:crypto";

import { LedgerShareTarget } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAccessContext } from "@/lib/auth";
import {
  applyLineAmounts,
  CLEANING_LINE,
  COMMISSION_AMOUNT_LINE,
  COMMISSION_RATE_LINE,
  correctedNetEarning,
  CUSTOM_LINE_SECTIONS,
  customLineKey,
  customLineSection,
  getCustomLines,
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
import { parseImportedOrderMetadata, parseNumberValue } from "@/lib/utils";

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

const LINE_KEYS = new Set([
  ...FEE_CATALOGUE.map((fee) => fee.column),
  TRIP_AMOUNT_LINE,
  CLEANING_LINE,
  COMMISSION_RATE_LINE,
  COMMISSION_AMOUNT_LINE,
]);
const isLineKey = (line: string) => LINE_KEYS.has(line) || customLineSection(line) != null;

const money = z.number().finite().nonnegative().max(1_000_000);

const bodySchema = z.union([
  z.object({
    line: z.string().refine(isLineKey),
    /** The amount as typed, without its sign -- a CSV line, a hand-added
     *  charge, or the commission. For the commission rate, a percentage.
     *  null goes back to the CSV's amount or the owner's terms. */
    amount: money.nullable().optional(),
    /** Whether the line counts toward the owner's share on this trip. */
    ownerShare: z.boolean().optional(),
    /** Takes a hand-added charge off the trip. */
    remove: z.literal(true).optional(),
  }),
  z.object({
    /** A charge added by hand under one of the statement's headings. */
    add: z.object({
      section: z.enum(CUSTOM_LINE_SECTIONS),
      label: z.string().trim().min(1).max(80),
      amount: money,
    }),
  }),
]);

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
    select: { line: true, amount: true, ownerShare: true, label: true },
  });
  const byLine = new Map(adjustments.map((adjustment) => [adjustment.line, adjustment]));
  const policy = resolveWorkspaceLedgerPolicy(order.workspace);
  const ownerOverrides = parseFeeShareOverrides(order.vehicle.owner?.feeShareOverrides);
  const corrected = applyLineAmounts(order.sourceMetadata, adjustments);
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
    tripNet: correctedNetEarning(order.sourceMetadata, order.totalPrice, adjustments),
    lines,
    amountLine: share(TRIP_AMOUNT_LINE, true),
    cleaning: { amount: cleaningFee, ...share(CLEANING_LINE, true) },
    custom: getCustomLines(adjustments).map((line) => ({ ...line, ownerShareDefault: true })),
    ownerShare: plan
      ? {
          ownerNet: plan.ownerNet,
          ownerRevenue: plan.ownerRevenue,
          commission: plan.commission,
          commissionRate: plan.commissionRate,
          commissionBase: plan.commissionBase,
          defaultCommissionRate: plan.defaultCommissionRate,
          commissionOverride: plan.commissionOverride,
          cleaningFee: plan.cleaningFee,
          otherCharges: plan.otherCharges,
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
  const actor = context.user.name;
  const workspaceId = order.workspaceId ?? context.workspace.id;
  let logged: Record<string, unknown>;

  if ("add" in parsed.data) {
    const { section, label, amount } = parsed.data.add;
    // Signed as the trip sees it: only income is money in.
    const signed = Math.round((section === "income" ? 1 : -1) * amount * 100) / 100;
    const line = customLineKey(section, randomBytes(6).toString("hex"));
    await prisma.orderLedgerAdjustment.create({
      data: { workspaceId, orderId, line, label, amount: signed, updatedBy: actor },
    });
    logged = { line, label, amount: signed };
  } else {
    const { line } = parsed.data;
    const section = customLineSection(line);
    const fee = FEE_CATALOGUE.find((definition) => definition.column === line);
    const existing = await prisma.orderLedgerAdjustment.findUnique({
      where: { orderId_line: { orderId, line } },
    });
    if (section && !existing) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    if (parsed.data.amount !== undefined && !fee && !section && line !== COMMISSION_RATE_LINE && line !== COMMISSION_AMOUNT_LINE) {
      // The trip's own amount and the cleaning fee have their own editors.
      return NextResponse.json({ error: "NOT_EDITABLE" }, { status: 400 });
    }
    if (parsed.data.remove && !section) return NextResponse.json({ error: "NOT_EDITABLE" }, { status: 400 });
    if (section && parsed.data.amount === null) return NextResponse.json({ error: "INVALID" }, { status: 400 });

    let amount = existing?.amount ?? null;
    let ownerShare = existing?.ownerShare ?? null;

    if (parsed.data.amount !== undefined) {
      const typed = parsed.data.amount;
      if (typed === null) {
        amount = null;
      } else if (section) {
        amount = Math.round((section === "income" ? 1 : -1) * typed * 100) / 100;
      } else if (line === COMMISSION_RATE_LINE) {
        if (typed > 100) return NextResponse.json({ error: "INVALID" }, { status: 400 });
        amount = Math.round(typed * 100) / 10000;
      } else if (line === COMMISSION_AMOUNT_LINE) {
        amount = Math.round(typed * 100) / 100;
      } else {
        // The sign is the line's, not the typist's: a discount or a
        // withheld tax stays a deduction however it was typed.
        const original = parseNumberValue(parseImportedOrderMetadata(order.sourceMetadata)?.financials?.[line]) ?? 0;
        const negative = fee?.sign === "debit" || original < 0;
        amount = Math.round((negative ? -1 : 1) * typed * 100) / 100;
        if (Math.abs(amount - original) < 0.005) amount = null;
      }
    }
    if (parsed.data.ownerShare !== undefined) {
      if (section) {
        // A hand-added charge counts toward the owner unless unticked.
        ownerShare = parsed.data.ownerShare ? null : false;
      } else {
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
    }

    if (parsed.data.remove || (amount == null && ownerShare == null)) {
      if (existing) await prisma.orderLedgerAdjustment.delete({ where: { id: existing.id } });
    } else {
      await prisma.orderLedgerAdjustment.upsert({
        where: { orderId_line: { orderId, line } },
        create: { workspaceId, orderId, line, amount, ownerShare, updatedBy: actor },
        update: { amount, ownerShare, updatedBy: actor },
      });
    }
    // A rate and an amount are two ways to say one commission.
    if (parsed.data.amount != null && (line === COMMISSION_RATE_LINE || line === COMMISSION_AMOUNT_LINE)) {
      await prisma.orderLedgerAdjustment.deleteMany({
        where: { orderId, line: line === COMMISSION_RATE_LINE ? COMMISSION_AMOUNT_LINE : COMMISSION_RATE_LINE },
      });
    }
    logged = { line, label: existing?.label ?? undefined, amount, ownerShare, removed: parsed.data.remove ?? undefined };
  }

  if (order.ownerLedgerSyncedAt) await syncOrderOwnerLedger(orderId);

  await logActivity({
    workspaceId: context.workspace.id,
    actor: context.user.name,
    action: "order_ledger_adjusted",
    entityType: "Order",
    entityId: orderId,
    metadata: logged,
  });

  return NextResponse.json(await statement(order));
}
