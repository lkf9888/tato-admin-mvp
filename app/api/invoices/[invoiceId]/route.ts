import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { requireCurrentAdminContext } from "@/lib/auth";
import { invoiceInputSchema, serializeInvoice, updateInvoice } from "@/lib/invoices";
import { logActivity } from "@/lib/orders";
import { prisma } from "@/lib/prisma";

type Params = Promise<{ invoiceId: string }>;

export async function PATCH(request: Request, { params }: { params: Params }) {
  const { invoiceId } = await params;
  const { workspace, user } = await requireCurrentAdminContext();
  const parsed = invoiceInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION_ERROR", detail: parsed.error.issues.slice(0, 3) }, { status: 400 });
  }
  const invoice = await updateInvoice(workspace.id, invoiceId, parsed.data);
  if (!invoice) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: "invoice_updated",
    entityType: "Invoice",
    entityId: invoice.id,
    metadata: { number: invoice.number, status: invoice.status, total: invoice.total },
  });
  revalidatePath("/invoices");
  return NextResponse.json({ invoice: serializeInvoice(invoice) });
}

export async function DELETE(_request: Request, { params }: { params: Params }) {
  const { invoiceId } = await params;
  const { workspace, user } = await requireCurrentAdminContext();
  const existing = await prisma.invoice.findFirst({ where: { id: invoiceId, workspaceId: workspace.id } });
  if (!existing) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  await prisma.invoice.delete({ where: { id: existing.id } });
  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: "invoice_deleted",
    entityType: "Invoice",
    entityId: existing.id,
    metadata: { number: existing.number, total: existing.total },
  });
  revalidatePath("/invoices");
  return NextResponse.json({ deletedId: existing.id });
}
