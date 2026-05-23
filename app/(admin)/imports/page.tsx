import { saveTuroSyncSettingsAction } from "@/app/actions";
import { CsvImportPanel } from "@/components/csv-import-panel";
import { SearchableSelect } from "@/components/searchable-select";
import { requireCurrentWorkspace } from "@/lib/auth";
import { getWorkspaceBillingSnapshot } from "@/lib/billing";
import type { Locale } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n-server";
import { formatDateTime } from "@/lib/utils";
import { prisma } from "@/lib/prisma";

export default async function ImportsPage({
  searchParams,
}: {
  searchParams: Promise<{ billing?: string; turoSync?: string }>;
}) {
  const workspace = await requireCurrentWorkspace();
  const [{ locale, messages }, batches, billingSnapshot, turoSyncConfig, params] = await Promise.all([
    getI18n(),
    prisma.importBatch.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { importedAt: "desc" },
    }),
    getWorkspaceBillingSnapshot(),
    prisma.turoSyncConfig.findUnique({
      where: { workspaceId: workspace.id },
    }),
    searchParams,
  ]);
  const importMessages = messages.imports;
  const turoSyncMessages = getTuroSyncSettingsCopy(locale);
  const turoSyncNotice = getTuroSyncSettingsNotice(params.turoSync, locale);
  const turoSyncYear = turoSyncConfig?.csvYear ?? new Date().getFullYear();
  const turoYearOptions = getTuroSyncYearOptions(turoSyncYear);
  const hasSavedRequestHeaders = Boolean(
    turoSyncConfig?.csvAuthHeader || turoSyncConfig?.csvHeaders,
  );

  return (
    <div className="space-y-3">
      <section className="rounded-lg border border-white/70 bg-white/90 p-3 shadow-sm sm:p-4">
        <div className="flex flex-col gap-1">
          <p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">
            {turoSyncMessages.kicker}
          </p>
          <h3 className="font-serif text-[1.05rem] text-slate-950 sm:text-[1.25rem]">
            {turoSyncMessages.title}
          </h3>
          <p className="max-w-3xl text-[12px] leading-5 text-slate-500">
            {turoSyncMessages.copy}
          </p>
        </div>

        {turoSyncNotice ? (
          <div className={turoSyncNotice.className}>
            {turoSyncNotice.message}
          </div>
        ) : null}

        <form action={saveTuroSyncSettingsAction} className="mt-3 grid gap-2 text-[12px] sm:gap-2.5">
          <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_180px]">
            <label className="grid gap-1">
              <span className="font-medium text-slate-700">{turoSyncMessages.csvUrl}</span>
              <input
                name="csvUrl"
                type="text"
                inputMode="url"
                defaultValue={turoSyncConfig?.csvUrl ?? ""}
                placeholder="https://turo.com/api/earnings/download?year={year}"
                className="min-h-9 border border-slate-200 bg-slate-50 px-3 py-2 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
              />
            </label>
            <label className="grid gap-1">
              <span className="font-medium text-slate-700">{turoSyncMessages.csvYear}</span>
              <SearchableSelect
                name="csvYear"
                defaultValue={String(turoSyncYear)}
                options={turoYearOptions.map((year) => ({ value: String(year), label: String(year) }))}
                placeholder={turoSyncMessages.csvYear}
                searchPlaceholder={turoSyncMessages.csvYear}
                className="min-h-9 border border-slate-200 bg-slate-50 px-3 py-2 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
              />
            </label>
          </div>

          <div className="border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] leading-4 text-slate-500">
            <span className="font-medium text-slate-700">{turoSyncMessages.discoveredEndpointLabel}</span>{" "}
            <code className="break-all text-slate-700">
              https://turo.com/api/earnings/download?year={"{year}"}
            </code>
            <span className="block pt-1">{turoSyncMessages.discoveredEndpointHint}</span>
          </div>

          <label className="grid gap-1">
            <span className="font-medium text-slate-700">{turoSyncMessages.curlLabel}</span>
            <textarea
              name="csvCurl"
              placeholder="curl 'https://turo.com/api/earnings/download?year=2026' -H 'cookie: ...'"
              rows={4}
              className="border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-[11px] outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
            />
            <span className="text-[11px] leading-4 text-slate-500">{turoSyncMessages.curlHint}</span>
          </label>

          <div className="grid gap-2 md:grid-cols-2">
            <label className="grid gap-1">
              <span className="font-medium text-slate-700">{turoSyncMessages.authHeader}</span>
              <input
                name="csvAuthHeader"
                placeholder={
                  turoSyncConfig?.csvAuthHeader
                    ? turoSyncMessages.savedSecretPlaceholder
                    : "Bearer ..."
                }
                className="min-h-9 border border-slate-200 bg-slate-50 px-3 py-2 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
              />
            </label>
            <label className="grid gap-1">
              <span className="font-medium text-slate-700">{turoSyncMessages.headers}</span>
              <input
                name="csvHeaders"
                placeholder={
                  turoSyncConfig?.csvHeaders
                    ? turoSyncMessages.savedSecretPlaceholder
                    : '{"x-api-key":"..."}'
                }
                className="min-h-9 border border-slate-200 bg-slate-50 px-3 py-2 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
              />
            </label>
          </div>

          {hasSavedRequestHeaders ? (
            <label className="flex items-start gap-2 border border-slate-200 bg-slate-50 px-3 py-2">
              <input name="clearSyncHeaders" type="checkbox" className="mt-0.5" />
              <span>
                <span className="block font-medium text-slate-700">{turoSyncMessages.clearHeaders}</span>
                <span className="text-[11px] leading-4 text-slate-500">{turoSyncMessages.clearHeadersHint}</span>
              </span>
            </label>
          ) : null}

          <label className="grid gap-1">
            <span className="font-medium text-slate-700">{turoSyncMessages.mapping}</span>
            <textarea
              name="csvMapping"
              defaultValue={turoSyncConfig?.csvMapping ?? ""}
              placeholder='{"Reservation ID":"externalOrderId"}'
              rows={3}
              className="border border-slate-200 bg-slate-50 px-3 py-2 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
            />
          </label>

          <div className="grid gap-2 md:grid-cols-2">
            <label className="flex items-start gap-2 border border-slate-200 bg-slate-50 px-3 py-2">
              <input
                name="createMissingVehicles"
                type="checkbox"
                defaultChecked={turoSyncConfig?.createMissingVehicles ?? true}
                className="mt-0.5"
              />
              <span>
                <span className="block font-medium text-slate-700">{turoSyncMessages.createMissing}</span>
                <span className="text-slate-500">{turoSyncMessages.createMissingHint}</span>
              </span>
            </label>
            <label className="flex items-start gap-2 border border-amber-200 bg-amber-50 px-3 py-2">
              <input
                name="archiveMissingOrders"
                type="checkbox"
                defaultChecked={turoSyncConfig?.archiveMissingOrders ?? false}
                className="mt-0.5"
              />
              <span>
                <span className="block font-medium text-amber-800">{turoSyncMessages.archiveMissing}</span>
                <span className="text-amber-700">{turoSyncMessages.archiveMissingHint}</span>
              </span>
            </label>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[11px] leading-4 text-slate-500">{turoSyncMessages.note}</p>
            <button className="min-h-9 bg-slate-950 px-4 py-2 font-medium text-white">
              {turoSyncMessages.save}
            </button>
          </div>
        </form>
      </section>

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

function getTuroSyncSettingsCopy(locale: Locale) {
  return locale === "zh"
    ? {
        kicker: "Turo 自动同步",
        title: "同步来源设置",
        copy:
          "把可直接下载 CSV 的链接粘贴到这里保存。日历里的「同步 Turo」按钮会优先使用这里的设置，不需要再去 Railway Variables 改 URL。",
        csvUrl: "CSV 直接下载 URL",
        csvYear: "下载年份",
        discoveredEndpointLabel: "Turo 下载接口：",
        discoveredEndpointHint:
          "Turo 的 Download CSV 按钮会调用这个接口，但它需要 Turo 登录态；如果直接同步出现 403，需要提供有效授权或继续手动下载上传。",
        curlLabel: "粘贴 Turo Download CSV cURL（推荐）",
        curlHint:
          "从 Chrome DevTools 的 Network 里对 download 请求使用 Copy as cURL。保存后不会回显 Cookie 或 Authorization。",
        savedSecretPlaceholder: "已保存，留空表示保持不变",
        clearHeaders: "清除已保存请求 Header",
        clearHeadersHint: "勾选后会删除已保存的 Cookie、Authorization 和额外 Headers。",
        authHeader: "Authorization Header（可选）",
        headers: "额外请求 Headers JSON（可选）",
        mapping: "字段映射 JSON（可选）",
        createMissing: "自动创建缺失车辆",
        createMissingHint: "第一次同步真实 Turo CSV 时建议开启。",
        archiveMissing: "归档 CSV 中缺失的旧 Turo 订单",
        archiveMissingHint: "除非 CSV 是完整订单来源，否则建议保持关闭，避免误归档历史订单。",
        note: "保存后回到日历点击「同步 Turo」即可立即测试。",
        save: "保存同步设置",
      }
    : {
        kicker: "Turo auto sync",
        title: "Sync source settings",
        copy:
          "Paste a direct-download CSV URL here. The calendar Sync Turo button will use this workspace setting before falling back to Railway variables.",
        csvUrl: "CSV direct-download URL",
        csvYear: "Download year",
        discoveredEndpointLabel: "Turo download endpoint:",
        discoveredEndpointHint:
          "Turo's Download CSV button calls this endpoint, but it requires a logged-in Turo session. If sync returns 403, provide valid auth or keep uploading the downloaded file manually.",
        curlLabel: "Paste Turo Download CSV cURL (recommended)",
        curlHint:
          "Use Copy as cURL on the download request in Chrome DevTools Network. Saved Cookie or Authorization values are not shown back on this page.",
        savedSecretPlaceholder: "Saved; leave blank to keep unchanged",
        clearHeaders: "Clear saved request headers",
        clearHeadersHint: "Removes saved Cookie, Authorization, and extra headers.",
        authHeader: "Authorization header (optional)",
        headers: "Extra request headers JSON (optional)",
        mapping: "Field mapping JSON (optional)",
        createMissing: "Auto-create missing vehicles",
        createMissingHint: "Recommended for the first real Turo CSV sync.",
        archiveMissing: "Archive old Turo orders missing from CSV",
        archiveMissingHint: "Keep this off unless the CSV is a complete order source.",
        note: "After saving, open Calendar and click Sync Turo to test it.",
        save: "Save sync settings",
      };
}

function getTuroSyncYearOptions(selectedYear: number) {
  const currentYear = new Date().getFullYear();
  const years = new Set<number>([selectedYear]);
  for (let year = currentYear + 1; year >= currentYear - 8; year -= 1) {
    years.add(year);
  }
  return Array.from(years).sort((a, b) => b - a);
}

function getTuroSyncSettingsNotice(status: string | undefined, locale: Locale) {
  if (!status) return null;
  const baseClass = "mt-3 border px-3 py-2 text-[12px]";
  const messages =
    locale === "zh"
      ? {
          saved: "Turo 同步设置已保存。",
          invalidUrl: "CSV URL 无效，请填写 http 或 https 开头的直接下载链接。",
          invalidJson: "Headers 或字段映射必须是有效 JSON 对象。",
          invalidCurl: "cURL 无法解析，请确认复制的是 Turo download 请求的 Copy as cURL。",
        }
      : {
          saved: "Turo sync settings saved.",
          invalidUrl: "The CSV URL is invalid. Use a direct http or https download link.",
          invalidJson: "Headers and field mapping must be valid JSON objects.",
          invalidCurl: "The cURL could not be parsed. Copy the Turo download request as cURL.",
        };

  if (status === "saved") {
    return {
      className: `${baseClass} border-emerald-200 bg-emerald-50 text-emerald-700`,
      message: messages.saved,
    };
  }

  if (status === "invalid-url") {
    return {
      className: `${baseClass} border-rose-200 bg-rose-50 text-rose-700`,
      message: messages.invalidUrl,
    };
  }

  if (status === "invalid-json") {
    return {
      className: `${baseClass} border-rose-200 bg-rose-50 text-rose-700`,
      message: messages.invalidJson,
    };
  }

  if (status === "invalid-curl") {
    return {
      className: `${baseClass} border-rose-200 bg-rose-50 text-rose-700`,
      message: messages.invalidCurl,
    };
  }

  return null;
}
