import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";

import { requireCurrentAdminContext } from "@/lib/auth";
import { logActivity } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import { makeOwnerLedgerReceiptPath, resolveUploadPath, sanitizeFilename } from "@/lib/uploads";

export const runtime = "nodejs";

type Params = Promise<{ ownerId: string; itemId: string }>;

function revalidateOwnerSurfaces(ownerId: string) {
  revalidatePath("/owners");
  revalidatePath("/owner-statements");
  revalidatePath(`/owners/${ownerId}`);
  revalidatePath(`/owners/${ownerId}/ledger`);
}

async function requireLedgerItem(ownerId: string, itemId: string) {
  const { workspace, user } = await requireCurrentAdminContext();
  const item = await prisma.ownerLedgerItem.findFirst({
    where: {
      id: itemId,
      ownerId,
      workspaceId: workspace.id,
    },
  });
  if (!item) return { error: "LEDGER_ITEM_NOT_FOUND" as const, status: 404 as const };
  return { workspace, user, item };
}

export async function GET(_request: NextRequest, { params }: { params: Params }) {
  const { ownerId, itemId } = await params;
  const context = await requireLedgerItem(ownerId, itemId);
  if ("error" in context) {
    return NextResponse.json({ error: context.error }, { status: context.status });
  }

  const receipts = await prisma.ownerLedgerReceipt.findMany({
    where: {
      workspaceId: context.workspace.id,
      itemId: context.item.id,
    },
    orderBy: { uploadedAt: "asc" },
  });

  return NextResponse.json({
    receipts: receipts.map((receipt) => ({
      ...receipt,
      url: `/api/owners/${ownerId}/ledger/${context.item.id}/receipts/file?receiptId=${receipt.id}`,
    })),
  });
}

export async function POST(request: NextRequest, { params }: { params: Params }) {
  const { ownerId, itemId } = await params;
  const context = await requireLedgerItem(ownerId, itemId);
  if ("error" in context) {
    return NextResponse.json({ error: context.error }, { status: context.status });
  }

  const formData = await request.formData();
  const files = formData.getAll("files").filter((entry): entry is File => entry instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "NO_FILES" }, { status: 400 });
  }

  const created = [];
  for (const file of files) {
    const safeName = sanitizeFilename(file.name);
    const pathname = makeOwnerLedgerReceiptPath(context.item.id, safeName);
    const absolutePath = resolveUploadPath(pathname);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, Buffer.from(await file.arrayBuffer()));

    const receipt = await prisma.ownerLedgerReceipt.create({
      data: {
        workspaceId: context.workspace.id,
        itemId: context.item.id,
        url: null,
        pathname,
        filename: safeName,
        contentType: file.type || null,
        size: file.size,
      },
    });
    created.push({
      ...receipt,
      url: `/api/owners/${ownerId}/ledger/${context.item.id}/receipts/file?receiptId=${receipt.id}`,
    });
  }

  const firstReceipt = created[0];
  if (firstReceipt) {
    await prisma.ownerLedgerItem.update({
      where: { id: context.item.id },
      data: {
        receiptUrl: firstReceipt.url,
        receiptPathname: firstReceipt.pathname,
        receiptFilename: firstReceipt.filename,
        receiptContentType: firstReceipt.contentType,
      },
    });
  }

  await logActivity({
    workspaceId: context.workspace.id,
    actor: context.user.name,
    action: "owner_ledger_receipts_uploaded",
    entityType: "OwnerLedgerItem",
    entityId: context.item.id,
    metadata: {
      ownerId,
      files: created.map((receipt) => receipt.filename),
    },
  });

  revalidateOwnerSurfaces(ownerId);
  return NextResponse.json({ receipts: created });
}
