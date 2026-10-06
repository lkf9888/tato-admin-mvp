import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { requireCurrentAdminContext } from "@/lib/auth";
import { isEmailConfigured, sendMail } from "@/lib/email";
import { renderInvoiceHtml, serializeInvoice } from "@/lib/invoices";
import { logActivity } from "@/lib/orders";
import { prisma } from "@/lib/prisma";

type Params = Promise<{ invoiceId: string }>;

/**
 * Email the invoice to its recipient, whole, in the body: the same
 * document the print page shows. A draft becomes SENT; a paid or void
 * one keeps its status. Replies reach the operator who sent it.
 */
export async function POST(request: Request, { params }: { params: Params }) {
  const { invoiceId } = await params;
  const { workspace, user } = await requireCurrentAdminContext();
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, workspaceId: workspace.id },
    include: { items: true },
  });
  if (!invoice) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (!invoice.recipientEmail) return NextResponse.json({ error: "NO_RECIPIENT" }, { status: 400 });
  if (!isEmailConfigured()) return NextResponse.json({ error: "EMAIL_NOT_CONFIGURED" }, { status: 400 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const locale = body.locale === "en" ? "en" : "zh";
  const message = typeof body.message === "string" ? body.message.trim().slice(0, 2000) : "";
  const issuer = workspace.name?.trim() || "TATO";
  const serialized = serializeInvoice(invoice);
  const kind = invoice.type === "RECEIPT" ? (locale === "en" ? "Receipt" : "收据") : locale === "en" ? "Invoice" : "发票";
  const escaped = message.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = `${escaped ? `<p style="white-space:pre-wrap;font-family:sans-serif">${escaped}</p><hr style="border:none;border-top:1px solid #eee;margin:16px 0">` : ""}${renderInvoiceHtml(serialized, issuer, locale)}`;
  const text = [
    message,
    `${kind} ${invoice.number}`,
    ...serialized.items.map((item) => `${item.description}  ${item.quantity} x ${item.unitPrice.toFixed(2)}`),
    `${locale === "en" ? "Total" : "合计"}: ${invoice.currency} ${invoice.total.toFixed(2)}`,
  ]
    .filter(Boolean)
    .join("\n");

  const sent = await sendMail({
    to: invoice.recipientEmail,
    subject: `${issuer} · ${kind} ${invoice.number}`.replace(/\s+/g, " "),
    text,
    html,
    ...(user.email ? { replyTo: user.email } : {}),
  });
  if (!sent.ok) return NextResponse.json({ error: "SEND_FAILED", detail: sent.reason ?? null }, { status: 502 });

  await prisma.invoice.update({
    where: { id: invoice.id },
    data: { lastSentAt: new Date(), ...(invoice.status === "DRAFT" ? { status: "SENT" } : {}) },
  });
  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: "invoice_sent",
    entityType: "Invoice",
    entityId: invoice.id,
    metadata: { number: invoice.number, to: invoice.recipientEmail },
  });
  revalidatePath("/invoices");
  return NextResponse.json({ ok: true, sentTo: invoice.recipientEmail });
}
