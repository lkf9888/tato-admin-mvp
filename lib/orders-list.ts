import "server-only";

import type { Prisma } from "@prisma/client";

import type { Locale } from "@/lib/i18n";
import { getOrderFeeLines } from "@/lib/ledger-policy";
import { prisma } from "@/lib/prisma";
import { readDirectBookingPayment } from "@/lib/stripe-refunds";
import { formatDateTime, getDisplayOrderNote, getOrderNetEarning, normalizeText } from "@/lib/utils";

/**
 * The orders list's filters, search and money, in one place: the orders
 * page shows them and the export writes them, and the two must agree on
 * which orders a filter means down to the last row.
 */

// Order sources are the same two enum values used elsewhere in the
// app; declared here so the filter controls stay a typed source of
// truth instead of a magic-string list.
export const ORDER_SOURCES = ["turo", "offline"] as const;
type OrderSource = (typeof ORDER_SOURCES)[number];

export type OrderListParams = {
  q?: string;
  status?: string;
  source?: string;
  vehicleId?: string;
  from?: string;
  to?: string;
};

/**
 * Parse a `yyyy-mm-dd` (HTML <input type="date"> output) into a Date,
 * or return `null` if missing/invalid. The Date is constructed with
 * the local server time as midnight; for `to` we shift to end-of-day
 * so the inclusive range matches user intent (`to=2026-04-30` includes
 * trips starting on April 30 at any hour).
 */
export function parseDateParam(raw: string | undefined, mode: "start" | "end"): Date | null {
  if (!raw) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) return null;
  const [, year, month, day] = match;
  const d = new Date(Number(year), Number(month) - 1, Number(day));
  if (Number.isNaN(d.getTime())) return null;
  if (mode === "end") d.setHours(23, 59, 59, 999);
  return d;
}

/**
 * Build the Prisma `where` clause for the structured filters.
 * The free-text `q` search is applied AFTER this query (in JS) so
 * users can match across many fields and Chinese names without
 * needing case-insensitive SQL (which SQLite doesn't ship).
 */
export function buildWhereClause(
  workspaceId: string,
  filters: {
    status?: string;
    source?: string;
    vehicleId?: string;
    from?: Date | null;
    to?: Date | null;
    /** A car-limited member's cars; null for the whole fleet. */
    vehicleIds?: string[] | null;
  },
): Prisma.OrderWhereInput {
  const where: Prisma.OrderWhereInput = {
    workspaceId,
    isArchived: false,
  };
  if (filters.status) where.status = filters.status as Prisma.OrderWhereInput["status"];
  if (filters.source && (ORDER_SOURCES as readonly string[]).includes(filters.source)) {
    where.source = filters.source as OrderSource;
  }
  if (filters.vehicleId) where.vehicleId = filters.vehicleId;
  if (filters.vehicleIds) {
    // A chosen car outside the member's cars selects nothing, not everything.
    where.vehicleId = filters.vehicleId
      ? filters.vehicleIds.includes(filters.vehicleId)
        ? filters.vehicleId
        : { in: [] }
      : { in: filters.vehicleIds };
  }
  if (filters.from || filters.to) {
    // Date range matches on `pickupDatetime` (the most common "when
    // was the rental?" semantic). `from` includes the whole start day,
    // `to` includes the whole end day, so `from=2026-04-01&to=2026-04-30`
    // returns every trip starting in April.
    where.pickupDatetime = {};
    if (filters.from) (where.pickupDatetime as { gte?: Date }).gte = filters.from;
    if (filters.to) (where.pickupDatetime as { lte?: Date }).lte = filters.to;
  }
  return where;
}

export async function fetchFilteredOrders(where: Prisma.OrderWhereInput) {
  return prisma.order.findMany({
    where,
    include: {
      vehicle: {
        include: {
          owner: true,
          // The row list edits the cleaning fee straight from this
          // page's data, so it needs the same dated rules the PATCH
          // response resolves against -- without them every order
          // opened here shows a blank fee regardless of what is
          // actually saved.
          cleaningFeeRules: { orderBy: { effectiveFrom: "desc" } },
        },
      },
      orderPayments: { select: { amount: true, paidAt: true } },
    },
    orderBy: { pickupDatetime: "desc" },
  });
}

export type ListedOrder = Awaited<ReturnType<typeof fetchFilteredOrders>>[number];

function buildOrderSearchText(order: ListedOrder, locale: Locale) {
  const netEarning = getOrderNetEarning(order.sourceMetadata, order.totalPrice);

  return normalizeText(
    [
      order.id,
      order.externalOrderId,
      order.source,
      order.status,
      order.renterName,
      order.renterPhone,
      order.vehicle.plateNumber,
      order.vehicle.nickname,
      order.vehicle.brand,
      order.vehicle.model,
      String(order.vehicle.year),
      order.vehicle.owner?.name,
      order.pickupLocation,
      order.returnLocation,
      order.paymentMethod,
      order.contractNumber,
      order.createdBy,
      getDisplayOrderNote(order.notes, order.source),
      formatDateTime(order.pickupDatetime, locale),
      formatDateTime(order.returnDatetime, locale),
      order.pickupDatetime.toISOString(),
      order.returnDatetime.toISOString(),
      netEarning != null ? String(netEarning) : null,
    ]
      .filter(Boolean)
      .join(" "),
  );
}

export function matchesOrderSearch(order: ListedOrder, query: string, locale: Locale) {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return true;

  const haystack = buildOrderSearchText(order, locale);
  return normalizedQuery.split(" ").every((term) => haystack.includes(term));
}

/** Every order the list's filters and search select, newest pick-up first. */
export async function loadOrderList(
  workspaceId: string,
  params: OrderListParams,
  locale: Locale,
  vehicleIds: string[] | null = null,
) {
  const where = buildWhereClause(workspaceId, {
    vehicleIds,
    status: params.status?.trim() || undefined,
    source: params.source?.trim() || undefined,
    vehicleId: params.vehicleId?.trim() || undefined,
    from: parseDateParam(params.from?.trim(), "start"),
    to: parseDateParam(params.to?.trim(), "end"),
  });
  const orders = await fetchFilteredOrders(where);
  const query = params.q?.trim() ?? "";
  return query ? orders.filter((order) => matchesOrderSearch(order, query, locale)) : orders;
}

/**
 * An order typed in by hand: offline, and not a rental-site booking. Only
 * these have their money tracked as payments someone marks received --
 * Turo settles its own, and a site booking is charged through Stripe.
 */
export function isManualOfflineOrder(order: Pick<ListedOrder, "source" | "sourceMetadata">) {
  return order.source === "offline" && !readDirectBookingPayment(order.sourceMetadata).isDirectBooking;
}

/**
 * The taxes on one order, by name. A site booking carries what it
 * charged (`taxLines`, or the older single `taxName`/`taxAmount`); a
 * Turo trip's export carries the sales tax Turo collected.
 */
export function orderTaxes(order: Pick<ListedOrder, "source" | "sourceMetadata">): Array<{ name: string; amount: number }> {
  if (order.source === "turo") {
    const salesTax = getOrderFeeLines(order.sourceMetadata)
      .filter((line) => line.column === "Sales tax")
      .reduce((sum, line) => sum + Math.abs(line.amount), 0);
    return salesTax > 0 ? [{ name: "Turo sales tax", amount: salesTax }] : [];
  }
  if (!order.sourceMetadata) return [];
  try {
    const metadata = JSON.parse(order.sourceMetadata) as {
      taxLines?: Array<{ name?: string; amount?: number }> | null;
      taxName?: string | null;
      taxAmount?: number | null;
    };
    if (Array.isArray(metadata.taxLines) && metadata.taxLines.length > 0) {
      return metadata.taxLines
        .filter((line) => Number(line.amount) > 0)
        .map((line) => ({ name: line.name || "Tax", amount: Number(line.amount) }));
    }
    if (Number(metadata.taxAmount) > 0) {
      return [{ name: metadata.taxName || "Tax", amount: Number(metadata.taxAmount) }];
    }
  } catch {
    // Not JSON: an order with no tax recorded.
  }
  return [];
}

const round = (value: number) => Math.round(value * 100) / 100;

/** What a hand-entered order has been paid, against what it costs. */
export function orderReceipts(order: Pick<ListedOrder, "totalPrice" | "orderPayments">) {
  const received = round(order.orderPayments.filter((row) => row.paidAt).reduce((sum, row) => sum + row.amount, 0));
  const total = order.totalPrice ?? 0;
  return { total, received, outstanding: round(Math.max(0, total - received)) };
}

/** The totals over a whole filtered list, not just the page in view. */
export function summarizeOrders(orders: ListedOrder[]) {
  let total = 0;
  let received = 0;
  let outstanding = 0;
  let manualCount = 0;
  const taxes = new Map<string, number>();
  for (const order of orders) {
    if (order.status === "cancelled") continue;
    total += getOrderNetEarning(order.sourceMetadata, order.totalPrice) ?? 0;
    for (const tax of orderTaxes(order)) taxes.set(tax.name, (taxes.get(tax.name) ?? 0) + tax.amount);
    if (isManualOfflineOrder(order)) {
      const money = orderReceipts(order);
      received += money.received;
      outstanding += money.outstanding;
      manualCount += 1;
    }
  }
  return {
    count: orders.filter((order) => order.status !== "cancelled").length,
    total: round(total),
    taxes: [...taxes].map(([name, amount]) => ({ name, amount: round(amount) })),
    manualCount,
    received: round(received),
    outstanding: round(outstanding),
  };
}

/**
 * Mark a selection of hand-entered orders as paid or unpaid.
 *
 * Paid: every instalment still open is marked received today, and if
 * the payments on file still fall short of the order's total, one more
 * row records the difference -- so "paid" means the order is covered,
 * not that some rows were ticked. Unpaid: every payment row goes back to
 * expected; the rows stay, so the schedule and amounts are not lost.
 *
 * Turo trips (Turo settles them) and rental-site bookings (Stripe does)
 * are skipped and counted, not touched.
 */
export async function markOrdersPayment(input: {
  workspaceId: string;
  ids: string[];
  action: "paid" | "unpaid";
  actor: string;
  /** A car-limited member's cars: orders on any other car are skipped. */
  vehicleIds?: string[] | null;
}) {
  const orders = await prisma.order.findMany({
    where: {
      id: { in: input.ids },
      workspaceId: input.workspaceId,
      isArchived: false,
      ...(input.vehicleIds ? { vehicleId: { in: input.vehicleIds } } : {}),
    },
    select: {
      id: true,
      source: true,
      sourceMetadata: true,
      totalPrice: true,
      orderPayments: { select: { id: true, amount: true, paidAt: true } },
    },
  });

  const now = new Date();
  let updated = 0;
  let skipped = input.ids.length - orders.length;
  for (const order of orders) {
    if (!isManualOfflineOrder(order)) {
      skipped += 1;
      continue;
    }
    if (input.action === "unpaid") {
      if (order.orderPayments.some((row) => row.paidAt)) {
        await prisma.orderPayment.updateMany({ where: { orderId: order.id }, data: { paidAt: null } });
        updated += 1;
      }
      continue;
    }

    const open = order.orderPayments.filter((row) => !row.paidAt);
    const received = orderReceipts(order).received + open.reduce((sum, row) => sum + row.amount, 0);
    const shortfall = Math.round(((order.totalPrice ?? 0) - received) * 100) / 100;
    if (open.length === 0 && shortfall <= 0.005) continue;
    await prisma.$transaction([
      prisma.orderPayment.updateMany({ where: { orderId: order.id, paidAt: null }, data: { paidAt: now } }),
      ...(shortfall > 0.005
        ? [
            prisma.orderPayment.create({
              data: {
                workspaceId: input.workspaceId,
                orderId: order.id,
                amount: shortfall,
                paidAt: now,
                note: "Marked paid from the orders list",
                createdBy: input.actor,
              },
            }),
          ]
        : []),
    ]);
    updated += 1;
  }

  return { updated, skipped };
}
