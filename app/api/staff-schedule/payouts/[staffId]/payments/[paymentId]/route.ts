import { NextRequest, NextResponse } from "next/server";

import { requireCurrentAdminContext } from "@/lib/auth";
import { logActivity } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import {
  isStaffPaymentPurpose,
  parseLedgerDay,
  revalidatePayoutPages,
  staffPaymentSchema,
} from "@/lib/staff-payout";

type Params = Promise<{ staffId: string; paymentId: string }>;

async function requirePayment(workspaceId: string, staffId: string, paymentId: string) {
  return prisma.staffPayment.findFirst({ where: { id: paymentId, staffId, workspaceId } });
}

export async function PATCH(request: NextRequest, { params }: { params: Params }) {
  const { staffId, paymentId } = await params;
  const { workspace, user } = await requireCurrentAdminContext();
  const existing = await requirePayment(workspace.id, staffId, paymentId);
  if (!existing) return NextResponse.json({ error: "PAYMENT_NOT_FOUND" }, { status: 404 });

  const parsed = staffPaymentSchema.safeParse(await request.json().catch(() => null));
  const paidAt = parsed.success ? parseLedgerDay(parsed.data.paidAt) : null;
  if (!parsed.success || !paidAt) {
    return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });
  }

  const payment = await prisma.staffPayment.update({
    where: { id: existing.id },
    data: {
      amount: Math.round(parsed.data.amount * 100) / 100,
      paidAt,
      purpose: isStaffPaymentPurpose(parsed.data.purpose) ? parsed.data.purpose : existing.purpose,
      method: parsed.data.method || null,
      reference: parsed.data.reference || null,
      notes: parsed.data.notes || null,
    },
  });

  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: "staff_payment_updated",
    entityType: "StaffPayment",
    entityId: payment.id,
    metadata: { staffId, amount: payment.amount, purpose: payment.purpose },
  });
  revalidatePayoutPages(staffId);
  return NextResponse.json({ payment });
}

export async function DELETE(_request: NextRequest, { params }: { params: Params }) {
  const { staffId, paymentId } = await params;
  const { workspace, user } = await requireCurrentAdminContext();
  const existing = await requirePayment(workspace.id, staffId, paymentId);
  if (!existing) return NextResponse.json({ error: "PAYMENT_NOT_FOUND" }, { status: 404 });

  await prisma.staffPayment.delete({ where: { id: existing.id } });
  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: "staff_payment_deleted",
    entityType: "StaffPayment",
    entityId: existing.id,
    metadata: { staffId, amount: existing.amount, purpose: existing.purpose },
  });
  revalidatePayoutPages(staffId);
  return NextResponse.json({ deletedId: existing.id });
}
