import { InvoicesClient } from "@/components/invoices-client";
import { requireCurrentWorkspace } from "@/lib/auth";
import { utcToZonedDate } from "@/lib/booking-time";
import { getI18n } from "@/lib/i18n-server";
import { serializeInvoice } from "@/lib/invoices";
import { prisma } from "@/lib/prisma";

export default async function InvoicesPage() {
  const workspace = await requireCurrentWorkspace();
  const { locale } = await getI18n();
  const invoices = await prisma.invoice.findMany({
    where: { workspaceId: workspace.id },
    orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
    include: { items: true },
  });
  return (
    <InvoicesClient
      locale={locale}
      today={utcToZonedDate(new Date())}
      invoices={invoices.map(serializeInvoice)}
    />
  );
}
