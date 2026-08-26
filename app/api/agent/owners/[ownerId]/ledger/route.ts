import { OwnerLedgerKind, type Prisma } from "@prisma/client";

import { authenticateAgent } from "@/lib/agent-auth";
import { corsPreflight, withCors } from "@/lib/agent-cors";
import { cursorArgs, iso, money, paginate, parseDate, parseLimit } from "@/lib/agent-read";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type Params = Promise<{ ownerId: string }>;

const KINDS = Object.values(OwnerLedgerKind) as string[];

/**
 * One owner's statement.
 *
 * Two totals, because they answer different questions and conflating
 * them is how a statement stops reconciling. `range` covers only the
 * rows returned by the filters; `balanceAllTime` is the whole ledger
 * and does not move when a date filter narrows the page. An agent
 * producing a monthly statement wants the first; one deciding whether
 * to pay somebody wants the second.
 */
export async function GET(request: Request, { params }: { params: Params }) {
  const agent = await authenticateAgent(request, "read");
  if (!agent) return withCors({ error: "UNAUTHORIZED" }, { status: 401 });

  const { ownerId } = await params;
  const owner = await prisma.owner.findFirst({
    where: { id: ownerId, workspaceId: agent.workspaceId },
    select: { id: true, name: true },
  });
  if (!owner) return withCors({ error: "NOT_FOUND" }, { status: 404 });

  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get("limit"));
  const cursor = url.searchParams.get("cursor");
  const kind = url.searchParams.get("kind");
  const from = parseDate(url.searchParams.get("from"));
  const to = parseDate(url.searchParams.get("to"));

  if (kind && !KINDS.includes(kind)) {
    return withCors(
      { error: "VALIDATION_ERROR", detail: `kind must be one of ${KINDS.join(", ")}` },
      { status: 400 },
    );
  }

  const where: Prisma.OwnerLedgerItemWhereInput = { ownerId: owner.id };
  if (kind) where.kind = kind as OwnerLedgerKind;
  if (from || to) {
    where.occurredAt = {};
    if (from) (where.occurredAt as { gte?: Date }).gte = from;
    if (to) (where.occurredAt as { lte?: Date }).lte = to;
  }

  const [rows, rangeAggregate, allTimeAggregate] = await Promise.all([
    prisma.ownerLedgerItem.findMany({
      where,
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...cursorArgs(cursor),
      include: {
        vehicle: { select: { id: true, plateNumber: true } },
        order: { select: { id: true, externalOrderId: true, renterName: true } },
      },
    }),
    prisma.ownerLedgerItem.aggregate({ where, _sum: { amount: true } }),
    prisma.ownerLedgerItem.aggregate({ where: { ownerId: owner.id }, _sum: { amount: true } }),
  ]);

  const { data, nextCursor } = paginate(rows, limit);

  return withCors({
    owner: { id: owner.id, name: owner.name },
    /** Net of the filtered rows -- every row matching the filters, not
     *  only the page returned. */
    rangeTotal: money(rangeAggregate._sum.amount ?? 0),
    /** The whole ledger, unaffected by filters. Positive is owed to
     *  the owner. */
    balanceAllTime: money(allTimeAggregate._sum.amount ?? 0),
    data: data.map((item) => ({
      id: item.id,
      kind: item.kind,
      /** Signed. Positive credits the owner, negative charges them. */
      amount: money(item.amount),
      occurredAt: iso(item.occurredAt),
      note: item.note,
      /** True when TATO wrote this line from a trip. False means a
       *  person entered it, and re-syncing will not overwrite it. */
      isAuto: item.isAuto,
      vehicle: item.vehicle
        ? { id: item.vehicle.id, plateNumber: item.vehicle.plateNumber }
        : null,
      order: item.order
        ? {
            id: item.order.id,
            externalOrderId: item.order.externalOrderId,
            renterName: item.order.renterName,
          }
        : null,
    })),
    nextCursor,
  });
}

export function OPTIONS() {
  return corsPreflight();
}
