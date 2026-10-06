import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { requireCurrentAdminContext } from "@/lib/auth";
import { createInvoice, invoiceInputSchema, serializeInvoice } from "@/lib/invoices";
import { logActivity } from "@/lib/orders";

export async function POST(request: Request) {
  const { workspace, user } = await requireCurrentAdminContext();
  const parsed = invoiceInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION_ERROR", detail: parsed.error.issues.slice(0, 3) }, { status: 400 });
  }
  const invoice = await createInvoice(workspace.id, parsed.data, user.name);
  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: "invoice_created",
    entityType: "Invoice",
    entityId: invoice.id,
    metadata: { number: invoice.number, type: invoice.type, total: invoice.total },
  });
  revalidatePath("/invoices");
  return NextResponse.json({ invoice: serializeInvoice(invoice) });
}
