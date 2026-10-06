import { readFile, stat } from "fs/promises";
import { NextRequest, NextResponse } from "next/server";

import { requireCurrentAdminContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  revalidateOwnerLedgerPages,
  revalidatePayoutPages,
  syncStaffReimbursementLedger,
} from "@/lib/staff-payout";
import { resolveUploadPath } from "@/lib/uploads";

export const runtime = "nodejs";

type Params = Promise<{ staffId: string; reimbursementId: string; receiptId: string }>;

async function requireReceipt(workspaceId: string, params: Awaited<Params>) {
  return prisma.staffReimbursementReceipt.findFirst({
    where: {
      id: params.receiptId,
      workspaceId,
      reimbursementId: params.reimbursementId,
      reimbursement: { staffId: params.staffId },
    },
  });
}

export async function GET(_request: NextRequest, { params }: { params: Params }) {
  const resolved = await params;
  const { workspace } = await requireCurrentAdminContext();
  const receipt = await requireReceipt(workspace.id, resolved);
  if (!receipt) return NextResponse.json({ error: "RECEIPT_NOT_FOUND" }, { status: 404 });

  const absolutePath = resolveUploadPath(receipt.pathname);
  const fileStat = await stat(absolutePath).catch(() => null);
  if (!fileStat?.isFile()) return NextResponse.json({ error: "FILE_NOT_FOUND" }, { status: 404 });

  const file = await readFile(absolutePath);
  return new NextResponse(file, {
    headers: {
      "Content-Type": receipt.contentType || "application/octet-stream",
      "Content-Length": String(file.length),
      "Content-Disposition": `inline; filename="${encodeURIComponent(receipt.filename || "receipt")}"`,
      "Cache-Control": "private, max-age=300",
    },
  });
}

/** Unlists the receipt here and on the owner's ledger; the file stays. */
export async function DELETE(_request: NextRequest, { params }: { params: Params }) {
  const resolved = await params;
  const { workspace } = await requireCurrentAdminContext();
  const receipt = await requireReceipt(workspace.id, resolved);
  if (!receipt) return NextResponse.json({ error: "RECEIPT_NOT_FOUND" }, { status: 404 });

  await prisma.staffReimbursementReceipt.delete({ where: { id: receipt.id } });
  await syncStaffReimbursementLedger(receipt.reimbursementId);
  revalidatePayoutPages(resolved.staffId);
  revalidateOwnerLedgerPages();
  return NextResponse.json({ deletedId: receipt.id });
}
