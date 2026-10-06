import { NextRequest, NextResponse } from "next/server";

import { requireCurrentAdminContext } from "@/lib/auth";
import { logActivity } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import {
  findWorkspaceStaff,
  isStaffPaymentPurpose,
  parseLedgerDay,
  revalidatePayoutPages,
  STAFF_PAYMENT_PURPOSE,
  staffPaymentSchema,
} from "@/lib/staff-payout";

type Params = Promise<{ staffId: string }>;

/** Record money paid to a staff member, against their pay or their reimbursements. */
export async function POST(request: NextRequest, { params }: { params: Params }) {
  const { staffId } = await params;
  const { workspace, user } = await requireCurrentAdminContext();
  const staff = await findWorkspaceStaff(workspace.id, staffId);
  if (!staff) return NextResponse.json({ error: "STAFF_NOT_FOUND" }, { status: 404 });

  const parsed = staffPaymentSchema.safeParse(await request.json().catch(() => null));
  const paidAt = parsed.success ? parseLedgerDay(parsed.data.paidAt) : null;
  if (!parsed.success || !paidAt) {
    return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });
  }

  const payment = await prisma.staffPayment.create({
    data: {
      workspaceId: workspace.id,
      staffId: staff.id,
      amount: Math.round(parsed.data.amount * 100) / 100,
      paidAt,
      purpose: isStaffPaymentPurpose(parsed.data.purpose) ? parsed.data.purpose : STAFF_PAYMENT_PURPOSE.task,
      method: parsed.data.method || null,
      reference: parsed.data.reference || null,
      notes: parsed.data.notes || null,
    },
  });

  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: "staff_payment_created",
    entityType: "StaffPayment",
    entityId: payment.id,
    metadata: { staffId: staff.id, amount: payment.amount, purpose: payment.purpose },
  });
  revalidatePayoutPages(staff.id);
  return NextResponse.json({ payment });
}
