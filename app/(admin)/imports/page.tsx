import { CsvImportPanel } from "@/components/csv-import-panel";
import { requireCurrentWorkspace } from "@/lib/auth";
import { getWorkspaceBillingSnapshot } from "@/lib/billing";
import { getI18n } from "@/lib/i18n-server";
import { formatDateTime } from "@/lib/utils";
import { prisma } from "@/lib/prisma";

export default async function ImportsPage({
  searchParams,
}: {
  searchParams: Promise<{ billing?: string }>;
}) {
  const workspace = await requireCurrentWorkspace();
  const [{ locale, messages }, batches, billingSnapshot, params] = await Promise.all([
    getI18n(),
    prisma.importBatch.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { importedAt: "desc" },
    }),
    getWorkspaceBillingSnapshot(),
    searchParams,
  ]);
  const importMessages = messages.imports;

  return (
    <div className="space-y-3">
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
          billingBypassActive: billingSnapshot.billingBypassActive,
          stripeConfigured: billingSnapshot.stripeConfigured,
          status: billingSnapshot.status,
        }}
        billingState={params.billing ?? null}
      />

      <section className="rounded-lg border border-white/70 bg-white/90 p-3 shadow-sm sm:p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">
              {importMessages.logKicker}
            </p>
            <h3 className="mt-1 font-serif text-[1.05rem] text-slate-950 sm:text-[1.25rem]">{importMessages.logTitle}</h3>
          </div>
          <p className="text-[12px] text-slate-500">{importMessages.sampleFile}</p>
        </div>

        <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-left text-[12px]">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 font-semibold text-slate-700">{importMessages.table.file}</th>
                <th className="px-3 py-2 font-semibold text-slate-700">
                  {importMessages.table.importedBy}
                </th>
                <th className="px-3 py-2 font-semibold text-slate-700">
                  {importMessages.table.importedAt}
                </th>
                <th className="px-3 py-2 font-semibold text-slate-700">{importMessages.table.rows}</th>
                <th className="px-3 py-2 font-semibold text-slate-700">
                  {importMessages.table.result}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {batches.map((batch) => (
                <tr key={batch.id}>
                  <td className="px-3 py-2 text-slate-700">{batch.fileName}</td>
                  <td className="px-3 py-2 text-slate-600">{batch.importedBy}</td>
                  <td className="px-3 py-2 text-slate-600">
                    {formatDateTime(batch.importedAt, locale)}
                  </td>
                  <td className="px-3 py-2 text-slate-600">{batch.totalRows}</td>
                  <td className="px-3 py-2 text-slate-600">
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
