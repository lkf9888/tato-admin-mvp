import { saveTuroSyncSettingsAction } from "@/app/actions";
import { CsvImportPanel } from "@/components/csv-import-panel";
import { InfoHint } from "@/components/info-hint";
import { SearchableSelect } from "@/components/searchable-select";
import { requireCurrentWorkspace } from "@/lib/auth";
import { getWorkspaceBillingSnapshot } from "@/lib/billing";
import type { Locale } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n-server";
import { formatDate, formatDateTime } from "@/lib/utils";
import { prisma } from "@/lib/prisma";
import {
  findUnconfirmedAssignments,
  findUnknownVehiclesFromImports,
} from "@/lib/vehicle-assignment";

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

  // Trips still to come whose car no plate has confirmed. This lives
  // on the imports page because importing the CSV is the fix.
  // Every Turo account the fleet actually uses, straight from the
  // vehicles. Derived rather than kept as its own list, so the options
  // are exactly the strings the matcher compares against.
  const knownTuroAccounts = (
    await prisma.vehicle.findMany({
      where: { workspaceId: workspace.id, turoAccount: { not: null } },
      distinct: ["turoAccount"],
      select: { turoAccount: true },
      orderBy: { turoAccount: "asc" },
    })
  )
    .map((row) => row.turoAccount)
    .filter((account): account is string => Boolean(account));

  const [unconfirmed, unknownVehicles] = await Promise.all([
    findUnconfirmedAssignments(workspace.id, { limit: 25 }),
    findUnknownVehiclesFromImports(workspace.id),
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
      {/* Closed by default. Seven inputs, a cURL paste and two secret
          headers -- configured once and then never again, yet it was
          the first 879px of a page whose job is "upload this file". */}
      <details className="group overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--surface)]">
        <summary className="tap-press flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-3 sm:px-4">
          <span className="min-w-0">
            <span className="block text-[10px] uppercase tracking-[0.22em] text-[var(--ink-soft)]">
              {turoSyncMessages.kicker}
            </span>
            <span className="mt-0.5 block truncate font-serif text-[1.05rem] text-[var(--ink)]">
              {turoSyncMessages.title}
            </span>
          </span>
          <span className="shrink-0 rounded-full border border-[var(--line)] px-2.5 py-1 text-[11px] font-semibold text-[var(--ink-soft)]">
            {turoSyncConfig?.csvUrl || hasSavedRequestHeaders
              ? turoSyncMessages.configured
              : turoSyncMessages.notConfigured}
          </span>
        </summary>

        <div className="border-t border-[var(--line)] px-3 pb-3 pt-3 sm:px-4">
        <p className="max-w-3xl text-[12px] leading-5 text-[var(--ink-soft)]">
          {turoSyncMessages.copy}
        </p>

        {turoSyncNotice ? (
          <div className={turoSyncNotice.className}>
            {turoSyncNotice.message}
          </div>
        ) : null}

        <form action={saveTuroSyncSettingsAction} className="mt-3 grid gap-2 text-[12px] sm:gap-2.5">
          <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_180px]">
            <label className="grid gap-1">
              <span className="font-medium text-[var(--ink-mid)]">{turoSyncMessages.csvUrl}</span>
              <input
                name="csvUrl"
                type="text"
                inputMode="url"
                defaultValue={turoSyncConfig?.csvUrl ?? ""}
                placeholder="https://turo.com/api/earnings/download?year={year}"
                className="min-h-9 border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2 outline-none transition focus:border-[var(--line-strong)] focus:ring-2 focus:ring-[var(--line)]"
              />
            </label>
            <label className="grid gap-1">
              <span className="font-medium text-[var(--ink-mid)]">{turoSyncMessages.csvYear}</span>
              <SearchableSelect
                name="csvYear"
                defaultValue={String(turoSyncYear)}
                options={turoYearOptions.map((year) => ({ value: String(year), label: String(year) }))}
                placeholder={turoSyncMessages.csvYear}
                searchPlaceholder={turoSyncMessages.csvYear}
                className="min-h-9 border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2 outline-none transition focus:border-[var(--line-strong)] focus:ring-2 focus:ring-[var(--line)]"
              />
            </label>
          </div>

          <label className="grid gap-1">
            <span className="font-medium text-[var(--ink-mid)]">{turoSyncMessages.curlLabel}</span>
            <textarea
              name="csvCurl"
              placeholder="curl 'https://turo.com/api/earnings/download?year=2026' -H 'cookie: ...'"
              rows={4}
              className="border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2 font-mono text-[11px] outline-none transition focus:border-[var(--line-strong)] focus:ring-2 focus:ring-[var(--line)]"
            />
            <span className="text-[11px] leading-4 text-[var(--ink-soft)]">{turoSyncMessages.curlHint}</span>
          </label>

          <div className="grid gap-2 md:grid-cols-2">
            <label className="grid gap-1">
              <span className="font-medium text-[var(--ink-mid)]">{turoSyncMessages.authHeader}</span>
              <input
                name="csvAuthHeader"
                placeholder={
                  turoSyncConfig?.csvAuthHeader
                    ? turoSyncMessages.savedSecretPlaceholder
                    : "Bearer ..."
                }
                className="min-h-9 border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2 outline-none transition focus:border-[var(--line-strong)] focus:ring-2 focus:ring-[var(--line)]"
              />
            </label>
            <label className="grid gap-1">
              <span className="font-medium text-[var(--ink-mid)]">{turoSyncMessages.headers}</span>
              <input
                name="csvHeaders"
                placeholder={
                  turoSyncConfig?.csvHeaders
                    ? turoSyncMessages.savedSecretPlaceholder
                    : '{"x-api-key":"..."}'
                }
                className="min-h-9 border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2 outline-none transition focus:border-[var(--line-strong)] focus:ring-2 focus:ring-[var(--line)]"
              />
            </label>
          </div>

          {hasSavedRequestHeaders ? (
            <label className="flex items-start gap-2 border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2">
              <input name="clearSyncHeaders" type="checkbox" className="mt-0.5" />
              <span>
                <span className="block font-medium text-[var(--ink-mid)]">{turoSyncMessages.clearHeaders}</span>
                <span className="text-[11px] leading-4 text-[var(--ink-soft)]">{turoSyncMessages.clearHeadersHint}</span>
              </span>
            </label>
          ) : null}

          {/* The column-mapping JSON box is gone. Hand-writing a field
              map is a developer's escape hatch, and auto-detection has
              handled every real export -- 2,221 rows on the last one.
              Carried as a hidden input so removing the control does not
              erase a mapping somebody already saved. */}
          <input type="hidden" name="csvMapping" defaultValue={turoSyncConfig?.csvMapping ?? ""} />

          <div className="grid gap-2">
            <label className="flex items-start gap-2 border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2">
              <input
                name="createMissingVehicles"
                type="checkbox"
                defaultChecked={turoSyncConfig?.createMissingVehicles ?? true}
                className="mt-0.5"
              />
              <span>
                <span className="block font-medium text-[var(--ink-mid)]">{turoSyncMessages.createMissing}</span>
                <span className="text-[var(--ink-soft)]">{turoSyncMessages.createMissingHint}</span>
              </span>
            </label>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[11px] leading-4 text-[var(--ink-soft)]">{turoSyncMessages.note}</p>
            <button className="min-h-9 bg-[var(--ink)] px-4 py-2 font-medium text-white">
              {turoSyncMessages.save}
            </button>
          </div>
        </form>
        </div>
      </details>

      {unconfirmed.length > 0 ? (
        <section className="rounded-lg border border-amber-300 bg-amber-50 p-3 sm:p-4">
          <p className="text-[10px] uppercase tracking-[0.22em] text-amber-800">
            {importMessages.unconfirmedKicker}
          </p>
          <h3 className="mt-1 flex items-center gap-1.5 font-serif text-[1.05rem] text-[var(--ink)] sm:text-[1.25rem]">
            {importMessages.unconfirmedTitle(unconfirmed.length)}
            <InfoHint text={importMessages.unconfirmedCopy} />
          </h3>

          {/* The count and the reason stay visible -- that is the
              warning. The rows behind it are for when someone acts on
              it, and five of them was most of this section's height. */}
          <details className="mt-3">
            <summary className="tap-press cursor-pointer list-none text-[12px] font-semibold text-amber-900 underline underline-offset-2">
              {importMessages.unconfirmedShowList(unconfirmed.length)}
            </summary>
          <ul className="mt-2 space-y-1.5">
            {unconfirmed.map((row) => (
              <li
                key={row.orderId}
                className="rounded-md border border-amber-200 bg-white/70 px-3 py-2 text-[12px] leading-5"
              >
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="font-semibold text-[var(--ink)]">{row.renterName}</span>
                  <span className="text-[var(--ink-soft)]">
                    {formatDate(row.pickupDatetime, locale)} → {formatDate(row.returnDatetime, locale)}
                  </span>
                  {row.externalOrderId ? (
                    <span className="text-[var(--ink-soft)] tabular-nums">
                      #{row.externalOrderId}
                    </span>
                  ) : null}
                </div>
                <div className="mt-0.5 text-[var(--ink-soft)]">
                  {row.plateNumber ? `${row.plateNumber} · ` : ""}
                  {row.vehicleLabel}
                  {/* The dangerous case is not "several cars matched"
                      -- that one refuses and files nothing. It is a
                      lone match in a fleet that may be missing the
                      real car, which looks certain and is not. */}
                  {row.sameModelYearCount > 1
                    ? ` — ${importMessages.unconfirmedSiblings(row.sameModelYearCount)}`
                    : ""}
                </div>
              </li>
            ))}
          </ul>
          </details>

          {/* Why the fleet was incomplete in the first place. A plate
              the CSV named and the fleet does not have is exactly what
              turns a model match into a confident wrong answer. */}
          {unknownVehicles.length > 0 ? (
            <p className="mt-3 rounded-md border border-amber-200 bg-white/70 px-3 py-2 text-[12px] leading-5 text-amber-900">
              {importMessages.unconfirmedUnknownVehicles(unknownVehicles.join("、"))}
            </p>
          ) : null}
        </section>
      ) : null}

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
        knownTuroAccounts={knownTuroAccounts}
      />

      <section className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3 sm:p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.22em] text-[var(--ink-soft)]">
              {importMessages.logKicker}
            </p>
            <h3 className="mt-1 font-serif text-[1.05rem] text-[var(--ink)] sm:text-[1.25rem]">{importMessages.logTitle}</h3>
          </div>
          <p className="text-[12px] text-[var(--ink-soft)]">{importMessages.sampleFile}</p>
        </div>

        <div className="mt-3 overflow-x-auto rounded-lg border border-[var(--line)]">
          <table className="min-w-full divide-y divide-[var(--line)] text-left text-[12px]">
            <thead className="bg-[var(--surface-muted)]">
              <tr>
                <th className="px-3 py-2 font-semibold text-[var(--ink-mid)]">{importMessages.table.file}</th>
                <th className="px-3 py-2 font-semibold text-[var(--ink-mid)]">
                  {importMessages.table.importedBy}
                </th>
                <th className="px-3 py-2 font-semibold text-[var(--ink-mid)]">
                  {importMessages.table.importedAt}
                </th>
                <th className="px-3 py-2 font-semibold text-[var(--ink-mid)]">{importMessages.table.rows}</th>
                <th className="px-3 py-2 font-semibold text-[var(--ink-mid)]">
                  {importMessages.table.result}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)] bg-white">
              {batches.slice(0, 3).map((batch) => (
                <tr key={batch.id}>
                  <td className="px-3 py-2 text-[var(--ink-mid)]">{batch.fileName}</td>
                  <td className="px-3 py-2 text-[var(--ink-mid)]">{batch.importedBy}</td>
                  <td className="px-3 py-2 text-[var(--ink-mid)]">
                    {formatDateTime(batch.importedAt, locale)}
                  </td>
                  <td className="px-3 py-2 text-[var(--ink-mid)]">{batch.totalRows}</td>
                  <td className="px-3 py-2 text-[var(--ink-mid)]">
                    {importMessages.table.batchResult(batch.successRows, batch.failedRows)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* The log only answers "did the last import work". Every batch
            ever was 1,436px of table for a question about the top row. */}
        {batches.length > 3 ? (
          <details className="mt-2">
            <summary className="tap-press cursor-pointer list-none text-[12px] font-semibold text-[var(--ink-soft)] underline underline-offset-2">
              {importMessages.logShowAll(batches.length - 3)}
            </summary>
            <ul className="mt-2 divide-y divide-[var(--line)] rounded-lg border border-[var(--line)] text-[12px]">
              {batches.slice(3).map((batch) => (
                <li key={batch.id} className="flex flex-wrap items-baseline gap-x-2 px-3 py-1.5">
                  <span className="text-[var(--ink-mid)]">{batch.fileName}</span>
                  <span className="text-[var(--ink-soft)]">
                    {formatDateTime(batch.importedAt, locale)}
                  </span>
                  <span className="text-[var(--ink-soft)]">
                    {importMessages.table.batchResult(batch.successRows, batch.failedRows)}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>
    </div>
  );
}

function getTuroSyncSettingsCopy(locale: Locale) {
  return locale === "zh"
    ? {
        kicker: "Turo 自动同步",
        title: "同步来源设置",
        configured: "已配置",
        notConfigured: "未配置",
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
        note: "保存后回到日历点击「同步 Turo」即可立即测试。",
        save: "保存同步设置",
      }
    : {
        kicker: "Turo auto sync",
        configured: "Configured",
        notConfigured: "Not set up",
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
