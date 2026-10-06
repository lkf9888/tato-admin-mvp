import { NextRequest, NextResponse } from "next/server";

import { requireCurrentAdminContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  revalidateOwnerLedgerPages,
  revalidatePayoutPages,
  saveStaffReimbursementReceipts,
  syncStaffReimbursementLedger,
} from "@/lib/staff-payout";
import { checkUploadLimits } from "@/lib/uploads";

export const runtime = "nodejs";

type Params = Promise<{ staffId: string; reimbursementId: string }>;

/** More receipts for a reimbursement already recorded. */
export async function POST(request: NextRequest, { params }: { params: Params }) {
  const { staffId, reimbursementId } = await params;
  const { workspace } = await requireCurrentAdminContext();
  const reimbursement = await prisma.staffReimbursement.findFirst({
    where: { id: reimbursementId, staffId, workspaceId: workspace.id },
    select: { id: true },
  });
  if (!reimbursement) return NextResponse.json({ error: "REIMBURSEMENT_NOT_FOUND" }, { status: 404 });

  const formData = await request.formData().catch(() => null);
  const files = (formData?.getAll("files") ?? []).filter(
    (entry): entry is File => entry instanceof File && entry.size > 0,
  );
  if (files.length === 0) return NextResponse.json({ error: "NO_FILES" }, { status: 400 });
  const limitError = checkUploadLimits(files);
  if (limitError) {
    const { status, ...payload } = limitError;
    return NextResponse.json(payload, { status });
  }

  await saveStaffReimbursementReceipts(workspace.id, reimbursement.id, files);
  await syncStaffReimbursementLedger(reimbursement.id);
  revalidatePayoutPages(staffId);
  revalidateOwnerLedgerPages();
  return NextResponse.json({ ok: true });
}
