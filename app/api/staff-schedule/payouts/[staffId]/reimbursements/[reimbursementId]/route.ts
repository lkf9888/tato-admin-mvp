import { NextRequest, NextResponse } from "next/server";

import { requireCurrentAdminContext } from "@/lib/auth";
import { logActivity } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import {
  parseLedgerDay,
  removeStaffReimbursementLedger,
  resolveWorkspaceVehicleId,
  revalidateOwnerLedgerPages,
  revalidatePayoutPages,
  staffReimbursementSchema,
  syncStaffReimbursementLedger,
} from "@/lib/staff-payout";

type Params = Promise<{ staffId: string; reimbursementId: string }>;

async function requireReimbursement(workspaceId: string, staffId: string, reimbursementId: string) {
  return prisma.staffReimbursement.findFirst({ where: { id: reimbursementId, staffId, workspaceId } });
}

export async function PATCH(request: NextRequest, { params }: { params: Params }) {
  const { staffId, reimbursementId } = await params;
  const { workspace, user } = await requireCurrentAdminContext();
  const existing = await requireReimbursement(workspace.id, staffId, reimbursementId);
  if (!existing) return NextResponse.json({ error: "REIMBURSEMENT_NOT_FOUND" }, { status: 404 });

  const parsed = staffReimbursementSchema.safeParse(await request.json().catch(() => null));
  const occurredAt = parsed.success ? parseLedgerDay(parsed.data.occurredAt) : null;
  if (!parsed.success || !occurredAt) {
    return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });
  }

  const reimbursement = await prisma.staffReimbursement.update({
    where: { id: existing.id },
    data: {
      vehicleId: await resolveWorkspaceVehicleId(workspace.id, parsed.data.vehicleId),
      amount: Math.round(parsed.data.amount * 100) / 100,
      occurredAt,
      note: parsed.data.note,
    },
  });
  await syncStaffReimbursementLedger(reimbursement.id);

  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: "staff_reimbursement_updated",
    entityType: "StaffReimbursement",
    entityId: reimbursement.id,
    metadata: { staffId, amount: reimbursement.amount, vehicleId: reimbursement.vehicleId },
  });
  revalidatePayoutPages(staffId);
  revalidateOwnerLedgerPages();
  return NextResponse.json({ id: reimbursement.id });
}

/** The receipt files stay on the volume, as owner-ledger receipts do. */
export async function DELETE(_request: NextRequest, { params }: { params: Params }) {
  const { staffId, reimbursementId } = await params;
  const { workspace, user } = await requireCurrentAdminContext();
  const existing = await requireReimbursement(workspace.id, staffId, reimbursementId);
  if (!existing) return NextResponse.json({ error: "REIMBURSEMENT_NOT_FOUND" }, { status: 404 });

  await prisma.staffReimbursement.delete({ where: { id: existing.id } });
  await removeStaffReimbursementLedger(existing.ownerLedgerItemId);

  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: "staff_reimbursement_deleted",
    entityType: "StaffReimbursement",
    entityId: existing.id,
    metadata: { staffId, amount: existing.amount, vehicleId: existing.vehicleId },
  });
  revalidatePayoutPages(staffId);
  revalidateOwnerLedgerPages();
  return NextResponse.json({ deletedId: existing.id });
}
