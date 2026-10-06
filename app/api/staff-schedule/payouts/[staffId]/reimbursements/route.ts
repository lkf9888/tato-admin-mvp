import { NextRequest, NextResponse } from "next/server";

import { requireCurrentAdminContext } from "@/lib/auth";
import { logActivity } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import {
  findWorkspaceStaff,
  parseLedgerDay,
  resolveWorkspaceVehicleId,
  revalidateOwnerLedgerPages,
  revalidatePayoutPages,
  saveStaffReimbursementReceipts,
  staffReimbursementSchema,
  syncStaffReimbursementLedger,
} from "@/lib/staff-payout";
import { checkUploadLimits } from "@/lib/uploads";

export const runtime = "nodejs";

type Params = Promise<{ staffId: string }>;

/**
 * Something a staff member paid for. Multipart, so the receipts arrive
 * with it; tied to a car, it lands on that car owner's ledger as well.
 */
export async function POST(request: NextRequest, { params }: { params: Params }) {
  const { staffId } = await params;
  const { workspace, user } = await requireCurrentAdminContext();
  const staff = await findWorkspaceStaff(workspace.id, staffId);
  if (!staff) return NextResponse.json({ error: "STAFF_NOT_FOUND" }, { status: 404 });

  const formData = await request.formData().catch(() => null);
  if (!formData) return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });

  const parsed = staffReimbursementSchema.safeParse({
    amount: formData.get("amount"),
    occurredAt: formData.get("occurredAt"),
    note: formData.get("note"),
    vehicleId: formData.get("vehicleId"),
  });
  const occurredAt = parsed.success ? parseLedgerDay(parsed.data.occurredAt) : null;
  if (!parsed.success || !occurredAt) {
    return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });
  }

  const files = formData.getAll("files").filter((entry): entry is File => entry instanceof File && entry.size > 0);
  const limitError = files.length ? checkUploadLimits(files) : null;
  if (limitError) {
    const { status, ...payload } = limitError;
    return NextResponse.json(payload, { status });
  }

  const reimbursement = await prisma.staffReimbursement.create({
    data: {
      workspaceId: workspace.id,
      staffId: staff.id,
      vehicleId: await resolveWorkspaceVehicleId(workspace.id, parsed.data.vehicleId),
      amount: Math.round(parsed.data.amount * 100) / 100,
      occurredAt,
      note: parsed.data.note,
    },
  });
  await saveStaffReimbursementReceipts(workspace.id, reimbursement.id, files);
  await syncStaffReimbursementLedger(reimbursement.id);

  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: "staff_reimbursement_created",
    entityType: "StaffReimbursement",
    entityId: reimbursement.id,
    metadata: { staffId: staff.id, amount: reimbursement.amount, vehicleId: reimbursement.vehicleId },
  });
  revalidatePayoutPages(staff.id);
  revalidateOwnerLedgerPages();
  return NextResponse.json({ id: reimbursement.id });
}
