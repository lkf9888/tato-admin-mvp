import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { getCurrentAdminUser } from "@/lib/auth";
import { logActivity } from "@/lib/orders";
import { prisma } from "@/lib/prisma";

type Params = Promise<{ ownerId: string; ruleId: string }>;

/**
 * Stop a recurring expense. Charges it already wrote stay on the ledger;
 * it writes no more. Kept rather than deleted, so the ledger can still
 * say where those rows came from.
 */
export async function DELETE(_request: NextRequest, { params }: { params: Params }) {
  const { ownerId, ruleId } = await params;
  const user = await getCurrentAdminUser();
  if (!user?.workspaceId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rule = await prisma.ownerLedgerRecurringExpense.findFirst({
    where: { id: ruleId, ownerId, workspaceId: user.workspaceId },
  });
  if (!rule) return NextResponse.json({ error: "Recurring expense not found" }, { status: 404 });

  if (!rule.stoppedAt) {
    await prisma.ownerLedgerRecurringExpense.update({
      where: { id: rule.id },
      data: { stoppedAt: new Date(), stoppedReason: "manual" },
    });
    await logActivity({
      workspaceId: user.workspaceId,
      actor: user.name,
      action: "owner_recurring_expense_stopped",
      entityType: "OwnerLedgerRecurringExpense",
      entityId: rule.id,
      metadata: { ownerId, amount: rule.amount, note: rule.note },
    });
  }

  revalidatePath(`/owners/${ownerId}`);
  revalidatePath(`/owners/${ownerId}/ledger`);
  return NextResponse.json({ ok: true });
}
