import { notFound } from "next/navigation";

import { PrintButton } from "@/components/print-button";
import { requireCurrentWorkspace } from "@/lib/auth";
import { renderInvoiceHtml, serializeInvoice } from "@/lib/invoices";
import { prisma } from "@/lib/prisma";

export const metadata = { robots: { index: false, follow: false } };

/**
 * The invoice alone on a white page, for the browser's Print -> Save as
 * PDF. Outside the admin shell so nothing else prints with it; the same
 * HTML the email carries.
 */
export default async function InvoicePrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ invoiceId: string }>;
  searchParams: Promise<{ locale?: string }>;
}) {
  const [{ invoiceId }, { locale }] = await Promise.all([params, searchParams]);
  const workspace = await requireCurrentWorkspace();
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, workspaceId: workspace.id },
    include: { items: true },
  });
  if (!invoice) notFound();
  const html = renderInvoiceHtml(serializeInvoice(invoice), workspace.name?.trim() || "TATO", locale === "en" ? "en" : "zh");
  return (
    <main style={{ background: "#fff", minHeight: "100vh", padding: "32px 24px" }}>
      <div className="print:hidden" style={{ maxWidth: 680, margin: "0 auto 16px", display: "flex", justifyContent: "flex-end" }}>
        <PrintButton label={locale === "en" ? "Print / Save as PDF" : "打印 / 存成 PDF"} />
      </div>
      <div style={{ maxWidth: 680, margin: "0 auto" }} dangerouslySetInnerHTML={{ __html: html }} />
    </main>
  );
}
