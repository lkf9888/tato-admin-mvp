import { CsvImportPanel } from "@/components/csv-import-panel";
import { getWorkspaceBillingSnapshot } from "@/lib/billing";
import { getI18n } from "@/lib/i18n-server";
import { formatDateTime } from "@/lib/utils";
import { prisma } from "@/lib/prisma";

export default async function ImportsPage({
  searchParams,
}: {
  searchParams: Promise<{ billing?: string }>;
}) {
  const [{ locale, messages }, batches, billingSnapshot, params] = await Promise.all([
    getI18n(),
    prisma.importBatch.findMany({
      orderBy: { importedAt: "desc" },
    }),
    getWorkspaceBillingSnapshot(),
    searchParams,
  ]);
  const importMessages = messages.imports;

  return (
    <div className="space-y-6">
      <CsvImportPanel
        locale={locale}
        billingSnapshot={{
          currentVehicleCount: billingSnapshot.currentVehicleCount,
          freeVehicleSlots: billingSnapshot.freeVehicleSlots,
          bonusVehicleSlots: billingSnapshot.bonusVehicleSlots,
          purchasedVehicleSlots: billingSnapshot.purchasedVehicleSlots,
          effectivePurchasedVehicleSlots: billingSnapshot.effectivePurchasedVehicleSlots,
          allowedVehicleCount: billingSnapshot.allowedVehicleCount,
          requiredPaidSlots: billingSnapshot.requiredPaidSlots,
          isOverLimit: billingSnapshot.isOverLimit,
          stripeConfigured: billingSnapshot.stripeConfigured,
          status: billingSnapshot.status,
        }}
        billingState={params.billing ?? null}
      />

      <section className="rounded-[1.75rem] border border-white/70 bg-white/90 p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-slate-500">
              {importMessages.logKicker}
            </p>
            <h3 className="mt-2 font-serif text-3xl text-slate-950">{importMessages.logTitle}</h3>
          </div>
          <p className="text-sm text-slate-500">{importMessages.sampleFile}</p>
        </div>

        <div className="mt-6 overflow-hidden rounded-3xl border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 font-semibold text-slate-700">{importMessages.table.file}</th>
                <th className="px-4 py-3 font-semibold text-slate-700">
                  {importMessages.table.importedBy}
                </th>
                <th className="px-4 py-3 font-semibold text-slate-700">
                  {importMessages.table.importedAt}
                </th>
                <th className="px-4 py-3 font-semibold text-slate-700">{importMessages.table.rows}</th>
                <th className="px-4 py-3 font-semibold text-slate-700">
                  {importMessages.table.result}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {batches.map((batch) => (
                <tr key={batch.id}>
                  <td className="px-4 py-3 text-slate-700">{batch.fileName}</td>
                  <td className="px-4 py-3 text-slate-600">{batch.importedBy}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {formatDateTime(batch.importedAt, locale)}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{batch.totalRows}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {importMessages.table.batchResult(batch.successRows, batch.failedRows)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
