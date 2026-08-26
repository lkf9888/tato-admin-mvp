import { authenticateAgent } from "@/lib/agent-auth";
import { corsPreflight, withCors } from "@/lib/agent-cors";
import { cursorArgs, iso, money, paginate, parseLimit } from "@/lib/agent-read";
import {
  FEE_CATALOGUE,
  parseFeeShareOverrides,
  resolveFeeTarget,
  resolveWorkspaceLedgerPolicy,
} from "@/lib/ledger-policy";
import { pickCommissionRule } from "@/lib/owner-commission";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

/**
 * Revenue-share owners, and the terms that govern them.
 *
 * The balance is the whole ledger, not a date range: it is what the
 * owner is owed or owes right now, which is the number both sides
 * argue about. `/owners/{id}/ledger` is where a range lives.
 *
 * Commission terms are resolved to whatever is in force today rather
 * than returned as a history. A rate is a term of a contract and the
 * contract gets renegotiated; an agent asking "what does this owner
 * cost" means today's answer, and the history is a different question
 * this endpoint should not make it read past.
 */
export async function GET(request: Request) {
  const agent = await authenticateAgent(request, "read");
  if (!agent) return withCors({ error: "UNAUTHORIZED" }, { status: 401 });

  const workspace = await prisma.workspace.findUnique({ where: { id: agent.workspaceId } });
  if (!workspace) return withCors({ error: "NOT_FOUND" }, { status: 404 });

  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get("limit"));
  const cursor = url.searchParams.get("cursor");

  const rows = await prisma.owner.findMany({
    where: { workspaceId: agent.workspaceId },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: limit + 1,
    ...cursorArgs(cursor),
    include: {
      vehicles: {
        where: { isArchived: false },
        orderBy: { plateNumber: "asc" },
        select: { id: true, plateNumber: true, brand: true, model: true, year: true },
      },
      commissionRules: { orderBy: { effectiveFrom: "desc" } },
      ledgerItems: { select: { amount: true } },
    },
  });

  const { data, nextCursor } = paginate(rows, limit);
  const policy = resolveWorkspaceLedgerPolicy(workspace);
  const now = new Date();

  return withCors({
    data: data.map((owner) => {
      const rule = pickCommissionRule(owner.commissionRules, now);
      const overrides = parseFeeShareOverrides(owner.feeShareOverrides);

      return {
        id: owner.id,
        name: owner.name,
        companyName: owner.companyName,
        email: owner.email,
        phone: owner.phone,
        vehicles: owner.vehicles.map((vehicle) => ({
          id: vehicle.id,
          plateNumber: vehicle.plateNumber,
          label: `${vehicle.year} ${vehicle.brand} ${vehicle.model}`,
        })),
        /** In force today. Null means no terms are set and each car's
         *  own rate applies. */
        commission: rule
          ? {
              ratePercent: Math.round(rule.rate * 1000) / 10,
              /** COMPANY_COLLECTS: we are paid and pay the owner out.
               *  OWNER_COLLECTS: the owner is paid and we invoice the
               *  commission, so a negative balance means they owe us. */
              settlement: rule.settlement,
              effectiveFrom: iso(rule.effectiveFrom),
              note: rule.note,
            }
          : null,
        /** Only the charges this owner is treated differently on. An
         *  empty list means they follow the workspace policy exactly. */
        feeShareExceptions: FEE_CATALOGUE.filter(
          (fee) => fee.column !== "Trip price" && overrides?.[fee.column],
        ).map((fee) => ({
          column: fee.column,
          target: resolveFeeTarget(fee.column, policy, overrides),
        })),
        /** Everything on the statement, all time. Positive is owed to
         *  the owner. */
        balance: money(owner.ledgerItems.reduce((sum, item) => sum + item.amount, 0)),
        createdAt: iso(owner.createdAt),
      };
    }),
    nextCursor,
  });
}

export function OPTIONS() {
  return corsPreflight();
}
