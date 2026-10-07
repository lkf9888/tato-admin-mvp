"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import Papa from "papaparse";

import { TuroTaskProgress, useLeaveGuard } from "@/components/turo-task-progress";
import { buildCsvHeaderMapping } from "@/lib/csv-mapping";
import { getCsvFieldOptions, getMessages, type Locale } from "@/lib/i18n";

type PreviewRow = Record<string, string>;

type BillingSnapshot = {
  currentVehicleCount: number;
  freeVehicleSlots: number;
  bonusVehicleSlots: number;
  purchasedVehicleSlots: number;
  effectivePurchasedVehicleSlots: number;
  allowedVehicleCount: number;
  requiredPaidSlots: number;
  isOverLimit: boolean;
  billingBypassActive: boolean;
  stripeConfigured: boolean;
  status: string;
};

type NewVehicleOption = {
  key: string;
  label: string;
  secondaryLabel: string;
  rowCount: number;
};

type ImportCheck = {
  selectableVehicleOptions: NewVehicleOption[];
  availableNewVehicleSlots: number;
  exceedsPurchasedLimit: boolean;
};

type LoadedFile = { name: string; headers: string[]; rows: PreviewRow[] };

/** "" is the main account; "__new__" is "another account", typed in. */
const NEW_ACCOUNT = "__new__";

/**
 * Turo CSV upload: a file, the account it came from, then import.
 *
 * There is no column mapping to fill in. Turo's export has the same
 * columns every time and the guess has read every real one; the whole
 * row is kept on each order anyway (sourceMetadata.rawRow), so nothing
 * is lost by not choosing columns. A file the guess cannot read is not
 * a Turo export, and is refused with the column it lacks.
 *
 * Cars are never created without a person seeing them: the import first
 * asks the server which cars are new, lists them, and only the ones
 * left ticked are created. Each car is a billing slot and an owner.
 */
export function CsvImportPanel({
  locale,
  billingSnapshot,
  billingState,
  knownTuroAccounts,
}: {
  locale: Locale;
  billingSnapshot: BillingSnapshot;
  billingState: string | null;
  /** Accounts already in use by vehicles in this fleet. Derived rather
   *  than configured: these are the exact strings the matcher compares
   *  against, so anything else is a typo waiting to file a car under
   *  an account that does not exist. */
  knownTuroAccounts: string[];
}) {
  const router = useRouter();
  const messages = getMessages(locale);
  const panelMessages = messages.imports.panel;
  const importMessages = messages.imports;
  const fieldLabels: Record<string, string> = Object.fromEntries(
    getCsvFieldOptions(locale).map((option) => [option.value, option.label]),
  );

  const [file, setFile] = useState<LoadedFile | null>(null);
  const [isReading, setIsReading] = useState(false);
  const [readStartedAt, setReadStartedAt] = useState(0);
  const [parseError, setParseError] = useState("");
  // Which Turo host account exported this file. An export only contains
  // its own account's listings, so this is a property of the whole file
  // -- and getting it wrong files a co-hosted car as a main-account
  // vehicle, after which it stops matching its own notification mail.
  // Null until picked: asked every time rather than defaulted, because
  // the default is exactly the mistake.
  const [accountChoice, setAccountChoice] = useState<string | null>(null);
  const [customAccount, setCustomAccount] = useState("");

  const [stage, setStage] = useState<"idle" | "checking" | "confirm" | "importing">("idle");
  const [startedAt, setStartedAt] = useState(0);
  const [newVehicles, setNewVehicles] = useState<NewVehicleOption[]>([]);
  const [newVehicleCap, setNewVehicleCap] = useState(0);
  const [selectedVehicleKeys, setSelectedVehicleKeys] = useState<string[]>([]);

  const [billingNotice, setBillingNotice] = useState("");
  const [failureBreakdown, setFailureBreakdown] = useState<
    Array<{ reason: string; count: number; sampleRows: number[] }>
  >([]);
  const [importAlert, setImportAlert] = useState<{
    type: "success" | "failure";
    title: string;
    message: string;
  } | null>(null);

  const busy = stage === "checking" || stage === "importing";
  useLeaveGuard(busy);

  useEffect(() => {
    if (billingState === "success") {
      setBillingNotice(panelMessages.billing.checkoutSuccess);
    } else if (billingState === "cancelled") {
      setBillingNotice(panelMessages.billing.checkoutCancelled);
    } else if (billingState === "updated") {
      setBillingNotice(panelMessages.billing.checkoutUpdated);
    }
  }, [billingState, panelMessages.billing]);

  const mapping = useMemo(() => (file ? buildCsvHeaderMapping(file.headers) : {}), [file]);
  const columnFor = useMemo(() => {
    const byField: Record<string, string> = {};
    for (const [column, field] of Object.entries(mapping)) {
      if (field && !byField[field]) byField[field] = column;
    }
    return byField;
  }, [mapping]);

  // The columns an order cannot be made without. Missing any of them,
  // the file is not a Turo earnings export (or Turo renamed a column,
  // which `guessCsvField` should then learn).
  const missingColumns = file
    ? [
        !["vehicleLabel", "vehicleName", "externalVehicleId", "vin"].some((field) => columnFor[field])
          ? panelMessages.oneVehicleIdentifier
          : null,
        !columnFor.externalOrderId ? fieldLabels.externalOrderId : null,
        !columnFor.renterName ? fieldLabels.renterName : null,
        !columnFor.pickupDatetime ? fieldLabels.pickupDatetime : null,
        !columnFor.returnDatetime ? fieldLabels.returnDatetime : null,
      ].filter((label): label is string => Boolean(label))
    : [];

  const summary = useMemo(() => {
    if (!file) return null;
    const vehicleColumn =
      columnFor.vehicleLabel ?? columnFor.vehicleName ?? columnFor.externalVehicleId ?? columnFor.vin;
    const cars = new Set(
      vehicleColumn ? file.rows.map((row) => row[vehicleColumn]?.trim()).filter(Boolean) : [],
    ).size;
    const times = columnFor.pickupDatetime
      ? file.rows
          .map((row) => new Date(row[columnFor.pickupDatetime] ?? "").getTime())
          .filter((time) => Number.isFinite(time))
      : [];
    const format = (time: number) =>
      new Date(time).toLocaleDateString(locale === "en" ? "en-CA" : "zh-CN", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    const range =
      times.length > 0 ? `${format(Math.min(...times))} – ${format(Math.max(...times))}` : "";
    return panelMessages.fileSummary(file.rows.length, cars, range);
  }, [file, columnFor, locale, panelMessages]);

  const turoAccount =
    accountChoice === null ? null : accountChoice === NEW_ACCOUNT ? customAccount.trim() : accountChoice;
  const accountReady = accountChoice !== null && (accountChoice !== NEW_ACCOUNT || customAccount.trim() !== "");
  const fileReady = Boolean(file) && missingColumns.length === 0;
  const blockedByBilling = billingSnapshot.isOverLimit && !billingSnapshot.billingBypassActive;
  const canStart = fileReady && accountReady && !busy && !blockedByBilling;

  function loadFile(picked: File) {
    setIsReading(true);
    setReadStartedAt(Date.now());
    setParseError("");
    setFile(null);
    setFailureBreakdown([]);
    setStage("idle");
    Papa.parse<PreviewRow>(picked, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        setIsReading(false);
        const headers = results.meta.fields ?? [];
        if (headers.length === 0 || results.data.length === 0) {
          setParseError(panelMessages.parseFailed);
          return;
        }
        setFile({ name: picked.name, headers, rows: results.data });
      },
      error: () => {
        setIsReading(false);
        setParseError(panelMessages.parseFailed);
      },
    });
  }

  /** Step one of an import: which cars in this file are new. */
  async function startImport() {
    if (!file || !canStart) return;
    setStartedAt(Date.now());
    setStage("checking");
    setFailureBreakdown([]);
    try {
      const response = await fetch("/api/billing/import-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: file.rows, mapping, createMissingVehicles: true }),
      });
      const payload = (await response.json().catch(() => ({}))) as Partial<ImportCheck> & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? panelMessages.billing.genericError);

      const options = payload.selectableVehicleOptions ?? [];
      if (options.length === 0) {
        await runImport({ createMissingVehicles: false, selectedVehicleKeys: [] });
        return;
      }
      // Within the plan, every new car can be added; past it, only as
      // many as there are slots left. Ticked by default either way --
      // the person is here to import the file, and unticks the odd one.
      const cap = payload.exceedsPurchasedLimit
        ? Math.max(0, payload.availableNewVehicleSlots ?? 0)
        : options.length;
      setNewVehicles(options);
      setNewVehicleCap(cap);
      setSelectedVehicleKeys(options.slice(0, cap).map((option) => option.key));
      setStage("confirm");
    } catch (error) {
      setStage("idle");
      setImportAlert({
        type: "failure",
        title: panelMessages.importFailureTitle,
        message: error instanceof Error ? error.message : panelMessages.genericFailure,
      });
    }
  }

  async function runImport(options: { createMissingVehicles: boolean; selectedVehicleKeys: string[] }) {
    if (!file) return;
    setStage("importing");
    try {
      const response = await fetch("/api/imports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: file.name,
          mapping,
          rows: file.rows,
          createMissingVehicles: options.createMissingVehicles,
          selectedVehicleKeys: options.selectedVehicleKeys,
          turoAccount: turoAccount || null,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        successRows?: number;
        failedRows?: number;
        createdVehicles?: number;
        skippedRows?: number;
        reclaimedIdentifiers?: Array<{ plateNumber: string; takenFrom: string }>;
        error?: string;
        failures?: Array<{ rowNumber: number; reason: string }>;
      };

      if (!response.ok) {
        const message =
          response.status === 402
            ? panelMessages.billing.limitExceeded
            : (payload.error ?? panelMessages.genericFailure);
        setImportAlert({ type: "failure", title: panelMessages.importFailureTitle, message });
        return;
      }

      // Reclaiming a VIN edits a vehicle nobody asked about, so it
      // is said out loud rather than left to the activity log.
      const reclaimed = payload.reclaimedIdentifiers ?? [];
      const message =
        panelMessages.importResult(
          payload.successRows ?? 0,
          payload.createdVehicles ?? 0,
          payload.failedRows ?? 0,
          payload.skippedRows ?? 0,
        ) +
        (reclaimed.length > 0
          ? ` ${panelMessages.reclaimedIdentifiers(
              reclaimed.map((row) => `${row.plateNumber} ← ${row.takenFrom}`).join("、"),
            )}`
          : "");
      setImportAlert({ type: "success", title: panelMessages.importSuccessTitle, message });

      // Per reason, so "12 failed" comes with why.
      const reasonMap = new Map<string, { count: number; sampleRows: number[] }>();
      for (const failure of payload.failures ?? []) {
        const entry = reasonMap.get(failure.reason) ?? { count: 0, sampleRows: [] };
        entry.count += 1;
        if (entry.sampleRows.length < 5) entry.sampleRows.push(failure.rowNumber);
        reasonMap.set(failure.reason, entry);
      }
      setFailureBreakdown(
        Array.from(reasonMap.entries())
          .map(([reason, entry]) => ({ reason, ...entry }))
          .sort((a, b) => b.count - a.count),
      );
      // The log, the unconfirmed-trips warning and the account list
      // below all changed.
      router.refresh();
    } catch {
      setImportAlert({
        type: "failure",
        title: panelMessages.importFailureTitle,
        message: panelMessages.genericFailure,
      });
    } finally {
      setStage("idle");
    }
  }

  function toggleVehicle(key: string) {
    setSelectedVehicleKeys((current) =>
      current.includes(key)
        ? current.filter((value) => value !== key)
        : current.length >= newVehicleCap
          ? current
          : [...current, key],
    );
  }

  const accountOptions = [
    { value: "", label: panelMessages.turoAccountMain },
    ...knownTuroAccounts.map((account) => ({ value: account, label: account })),
    { value: NEW_ACCOUNT, label: panelMessages.turoAccountOther },
  ];

  const cardClass =
    "rounded-lg border border-[color:var(--line)] bg-white px-4 py-3.5 shadow-[0_20px_50px_-40px_rgba(17,19,24,0.4)] sm:px-5 sm:py-4";
  const stepBadge = (n: number, done: boolean) => (
    <span
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
        done ? "bg-[var(--ok-bg)] text-[var(--ok-fg)]" : "bg-[var(--ink)] text-white"
      }`}
    >
      {done ? "✓" : n}
    </span>
  );

  return (
    <>
      <section className="rounded-lg border border-[color:var(--line)] bg-white px-3 py-3 shadow-[0_20px_50px_-40px_rgba(17,19,24,0.4)] sm:px-4 sm:py-3.5">
        {/* The four steps are read once and then known. Folded away
            rather than deleted, because the first import is the one
            that needs them. */}
        <details>
          <summary className="tap-press cursor-pointer list-none text-[10px] font-semibold uppercase tracking-[0.16em] text-[color:var(--ink-soft)] underline underline-offset-2">
            {importMessages.guideTitle}
          </summary>
          <ol className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
            {importMessages.guideSteps.map((step, index) => (
              <li
                key={step.title}
                className="flex gap-2.5 rounded-md border border-[color:var(--line)] bg-[var(--surface-muted)] px-2.5 py-2"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--ink)] text-[11px] font-semibold text-white tabular-nums">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <p className="text-[12px] font-semibold text-[color:var(--ink)]">{step.title}</p>
                  <p className="mt-0.5 text-[11px] leading-4 text-[color:var(--ink-soft)]">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </details>
      </section>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-3">
          {/* 1. The file */}
          <section className={cardClass}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                {stepBadge(1, fileReady)}
                <div className="min-w-0">
                  <h3 className="text-[15px] font-semibold text-[color:var(--ink)]">
                    {panelMessages.uploadTitle}
                  </h3>
                  <p className="truncate text-[12px] text-[color:var(--ink-soft)]">
                    {file ? file.name : panelMessages.uploadHint}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <a
                  href="https://turo.com/business/earnings"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center rounded-md border border-[color:var(--line)] bg-white px-3 py-2 text-[13px] font-medium text-[color:var(--ink)] transition hover:border-[var(--ink)]"
                >
                  {panelMessages.openTuroPage}
                </a>
                <label
                  className={`inline-flex cursor-pointer items-center rounded-md px-3 py-2 text-[13px] font-medium transition ${
                    file
                      ? "border border-[color:var(--line)] bg-white text-[color:var(--ink)] hover:border-[var(--ink)]"
                      : "bg-[var(--ink)] text-white hover:bg-[color:rgba(18,18,20,0.85)]"
                  } ${busy ? "pointer-events-none opacity-50" : ""}`}
                >
                  {file ? panelMessages.chooseAnother : panelMessages.chooseFile}
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    disabled={busy}
                    onChange={(event) => {
                      const picked = event.target.files?.[0];
                      event.target.value = "";
                      if (picked) loadFile(picked);
                    }}
                  />
                </label>
              </div>
            </div>

            {isReading ? (
              <div className="mt-3">
                <TuroTaskProgress
                  locale={locale === "en" ? "en" : "zh"}
                  steps={[panelMessages.reading]}
                  current={0}
                  startedAt={readStartedAt}
                />
              </div>
            ) : null}
            {parseError ? (
              <p className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{parseError}</p>
            ) : null}

            {file ? (
              <div className="mt-3 space-y-2">
                {missingColumns.length > 0 ? (
                  <p className="rounded-md bg-rose-50 px-3 py-2 text-[12px] leading-5 text-rose-700">
                    {panelMessages.notTuroFile(missingColumns.join("、"))}
                  </p>
                ) : (
                  <p className="text-[13px] font-medium text-[color:var(--ink)]">{summary}</p>
                )}
                <details>
                  <summary className="tap-press cursor-pointer list-none text-[12px] font-semibold text-[color:var(--ink-soft)] underline underline-offset-2">
                    {panelMessages.previewToggle(file.headers.length)}
                  </summary>
                  <div className="mt-2 overflow-x-auto rounded-md border border-[color:var(--line)]">
                    <table className="min-w-full divide-y divide-[color:var(--line)] text-left text-[12px]">
                      <thead className="bg-[var(--surface-muted)]">
                        <tr>
                          {file.headers.map((header) => (
                            <th key={header} className="whitespace-nowrap px-3 py-2 font-semibold text-[color:var(--ink)]">
                              {header}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[color:var(--line)] bg-white">
                        {file.rows.slice(0, 5).map((row, index) => (
                          <tr key={index}>
                            {file.headers.map((header) => (
                              <td key={header} className="whitespace-nowrap px-3 py-2 text-[color:var(--ink-soft)]">
                                {row[header] || "—"}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              </div>
            ) : null}
          </section>

          {/* 2. The account */}
          <section className={`${cardClass} transition ${fileReady ? "" : "opacity-60"}`}>
            <div className="flex items-center gap-3">
              {stepBadge(2, fileReady && accountReady)}
              <div className="min-w-0">
                <h3 className="text-[15px] font-semibold text-[color:var(--ink)]">{panelMessages.accountStep}</h3>
                <p className="text-[12px] leading-5 text-[color:var(--ink-soft)]">{panelMessages.turoAccountHint}</p>
              </div>
            </div>
            {/* Picked, not typed. The account name has to match the one
                already on the vehicles exactly -- "Kevin" and "kevin"
                are two different fleets to the matcher -- and typing it
                fresh on every import is how that goes wrong. */}
            <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label={panelMessages.accountStep}>
              {accountOptions.map((option) => {
                const active = accountChoice === option.value;
                return (
                  <button
                    key={option.value || "(main)"}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    disabled={!fileReady || busy}
                    onClick={() => setAccountChoice(option.value)}
                    className={`tap-press min-h-9 rounded-md border px-3 py-1.5 text-[13px] font-medium transition disabled:cursor-not-allowed ${
                      active
                        ? "border-[var(--ink)] bg-[var(--ink)] text-white"
                        : "border-[color:var(--line-strong)] bg-white text-[color:var(--ink)] hover:border-[var(--ink)]"
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
            {accountChoice === NEW_ACCOUNT ? (
              <input
                autoFocus
                value={customAccount}
                disabled={busy}
                onChange={(event) => setCustomAccount(event.target.value)}
                placeholder={panelMessages.turoAccountPlaceholder}
                className="mt-2 w-full rounded-md border border-[color:var(--line-strong)] bg-white px-2.5 py-1.5 text-[13px] outline-none focus:border-[var(--brand)] sm:max-w-xs"
              />
            ) : null}
          </section>

          {/* 3. Import */}
          <section className={`${cardClass} transition ${fileReady && accountReady ? "" : "opacity-60"}`}>
            <div className="flex items-center gap-3">
              {stepBadge(3, false)}
              <div className="min-w-0">
                <h3 className="text-[15px] font-semibold text-[color:var(--ink)]">{panelMessages.importStep}</h3>
                <p className="text-[12px] leading-5 text-[color:var(--ink-soft)]">{panelMessages.importStepHint}</p>
              </div>
            </div>

            <div className="mt-3 space-y-3">
              {blockedByBilling ? (
                <p className="rounded-md bg-amber-50 px-3 py-2 text-[12px] text-amber-700">
                  {panelMessages.billing.limitExceeded}{" "}
                  <Link href="/billing" className="font-semibold underline underline-offset-2">
                    {panelMessages.billing.openBillingPage}
                  </Link>
                </p>
              ) : null}

              {busy ? (
                <TuroTaskProgress
                  locale={locale === "en" ? "en" : "zh"}
                  steps={panelMessages.progressSteps}
                  current={stage === "checking" ? 1 : 2}
                  startedAt={startedAt}
                  note={file ? panelMessages.progressNote(file.rows.length) : undefined}
                />
              ) : (
                <button
                  type="button"
                  disabled={!canStart}
                  onClick={() => void startImport()}
                  className="tap-press w-full rounded-md bg-[var(--accent)] px-4 py-2.5 text-[14px] font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:bg-[color:var(--line)] disabled:text-[color:var(--ink-soft)]"
                >
                  {!fileReady
                    ? panelMessages.needsFile
                    : !accountReady
                      ? panelMessages.needsAccount
                      : panelMessages.runImport}
                </button>
              )}

              {failureBreakdown.length > 0 ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
                  <p className="font-semibold">{panelMessages.failureBreakdown}</p>
                  <ul className="mt-1 space-y-1">
                    {failureBreakdown.slice(0, 8).map((entry) => (
                      <li key={entry.reason}>
                        <span className="font-medium">{entry.reason}</span>
                        <span className="mx-1">·</span>
                        <span className="tabular-nums">{panelMessages.failureRows(entry.count)}</span>
                        {entry.sampleRows.length > 0 ? (
                          <span className="ml-1 text-amber-800">
                            ({panelMessages.failureSampleRows}: {entry.sampleRows.join(", ")}
                            {entry.count > entry.sampleRows.length ? "…" : ""})
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </section>
        </div>

        <aside className="space-y-4">
          <section className="rounded-lg border border-[color:var(--line)] bg-white px-5 py-4 shadow-[0_20px_50px_-40px_rgba(17,19,24,0.4)]">
            <h3 className="text-[14px] font-semibold text-[color:var(--ink)]">{panelMessages.billing.title}</h3>
            <p className="mt-2 text-[12px] leading-5 text-[color:var(--ink-soft)]">{panelMessages.billing.copy}</p>

            <dl className="mt-3 space-y-1.5 text-[12px]">
              {[
                [panelMessages.billing.currentVehicles, billingSnapshot.currentVehicleCount],
                [panelMessages.billing.freeIncluded, billingSnapshot.freeVehicleSlots],
                [messages.billingPage.couponBonus, billingSnapshot.bonusVehicleSlots],
                [panelMessages.billing.paidSlots, billingSnapshot.effectivePurchasedVehicleSlots],
                [panelMessages.billing.allowedTotal, billingSnapshot.allowedVehicleCount],
              ].map(([label, value]) => (
                <div
                  key={label as string}
                  className="flex items-center justify-between gap-2 border-b border-[color:var(--line)] pb-1.5 last:border-0 last:pb-0"
                >
                  <dt className="text-[color:var(--ink-soft)]">{label}</dt>
                  <dd className="font-semibold tabular-nums text-[color:var(--ink)]">{value}</dd>
                </div>
              ))}
              <div className="flex items-center justify-between gap-2">
                <dt className="text-[color:var(--ink-soft)]">{panelMessages.billing.subscriptionStatus}</dt>
                <dd className="font-semibold capitalize text-[color:var(--ink)]">{billingSnapshot.status}</dd>
              </div>
            </dl>

            <div className="mt-3 space-y-2">
              {!billingSnapshot.stripeConfigured ? (
                <p className="rounded-md bg-amber-50 px-3 py-2 text-[12px] text-amber-700">
                  {panelMessages.billing.notConfigured}
                </p>
              ) : null}
              {billingSnapshot.billingBypassActive ? (
                <p className="rounded-md bg-sky-50 px-3 py-2 text-[12px] text-sky-800">
                  {messages.billingPage.debugBypassNotice}
                </p>
              ) : null}
              {billingNotice ? (
                <p className="rounded-md bg-emerald-50 px-3 py-2 text-[12px] text-emerald-700">{billingNotice}</p>
              ) : null}
              <Link
                href="/billing"
                className="block w-full rounded-md bg-[var(--ink)] px-3 py-2 text-center text-[13px] font-medium text-white transition hover:bg-[color:rgba(18,18,20,0.85)]"
              >
                {panelMessages.billing.openBillingPage}
              </Link>
            </div>
          </section>
        </aside>
      </div>

      {stage === "confirm" ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-[var(--ink)]/45 sm:items-center sm:px-4">
          <div
            role="dialog"
            aria-modal="true"
            className="flex max-h-[90vh] w-full max-w-xl flex-col rounded-t-xl border border-[var(--line)] bg-white p-4 shadow-2xl sm:rounded-lg"
          >
            <p className="text-[10px] uppercase tracking-[0.22em] text-[var(--ink-soft)]">
              {panelMessages.newVehiclesKicker}
            </p>
            <h3 className="mt-1 font-serif text-[1.25rem] text-[var(--ink)]">
              {panelMessages.newVehiclesTitle(newVehicles.length)}
            </h3>
            <p className="mt-1.5 text-[12px] leading-5 text-[var(--ink-mid)]">{panelMessages.newVehiclesCopy}</p>
            {newVehicleCap < newVehicles.length ? (
              <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
                {panelMessages.newVehiclesQuota(newVehicleCap)}{" "}
                <Link href="/billing" className="font-semibold underline underline-offset-2">
                  {panelMessages.billing.openBillingPage}
                </Link>
              </p>
            ) : null}

            <div className="mt-3 min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
              {newVehicles.map((vehicle) => {
                const checked = selectedVehicleKeys.includes(vehicle.key);
                const locked = !checked && selectedVehicleKeys.length >= newVehicleCap;
                return (
                  <label
                    key={vehicle.key}
                    className={`flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2 transition ${
                      checked ? "border-[var(--ink)] bg-white" : "border-[var(--line)] bg-white/75"
                    } ${locked ? "cursor-not-allowed opacity-50" : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={locked}
                      onChange={() => toggleVehicle(vehicle.key)}
                      className="mt-0.5 h-4 w-4 rounded border-[var(--line-strong)]"
                    />
                    <span className="block min-w-0">
                      <span className="block text-[13px] font-medium text-[var(--ink)]">{vehicle.label}</span>
                      <span className="mt-0.5 block text-[11px] text-[var(--ink-soft)]">
                        {vehicle.secondaryLabel ? `${vehicle.secondaryLabel} · ` : ""}
                        {panelMessages.newVehicleTrips(vehicle.rowCount)}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>

            <div className="mt-4 flex flex-col gap-2 sm:flex-row-reverse">
              <button
                type="button"
                disabled={selectedVehicleKeys.length === 0}
                onClick={() =>
                  void runImport({ createMissingVehicles: true, selectedVehicleKeys })
                }
                className="tap-press flex-1 rounded-md bg-[var(--accent)] px-3 py-2.5 text-[13px] font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:bg-[var(--line)] disabled:text-[var(--ink-soft)]"
              >
                {panelMessages.confirmCreate(selectedVehicleKeys.length)}
              </button>
              <button
                type="button"
                onClick={() => void runImport({ createMissingVehicles: false, selectedVehicleKeys: [] })}
                className="tap-press flex-1 rounded-md border border-[var(--line-strong)] bg-white px-3 py-2.5 text-[13px] font-medium text-[var(--ink)]"
              >
                {panelMessages.skipCreate}
              </button>
              <button
                type="button"
                onClick={() => setStage("idle")}
                className="tap-press rounded-md px-3 py-2.5 text-[13px] font-medium text-[var(--ink-soft)]"
              >
                {panelMessages.cancel}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {importAlert ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[var(--ink)]/45 px-4">
          <div className="w-full max-w-lg rounded-lg border border-[var(--line)] bg-white p-5 shadow-2xl">
            <p
              className={`text-[10px] font-semibold uppercase tracking-[0.22em] ${
                importAlert.type === "success" ? "text-emerald-600" : "text-rose-600"
              }`}
            >
              {importAlert.type === "success" ? "CSV" : "Error"}
            </p>
            <h3 className="mt-2 font-serif text-[1.45rem] text-[var(--ink)]">{importAlert.title}</h3>
            <p className="mt-3 whitespace-pre-wrap text-[13px] leading-6 text-[var(--ink-mid)]">
              {importAlert.message}
            </p>
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setImportAlert(null)}
                className="rounded-md bg-[var(--ink)] px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-[var(--ink)]"
              >
                {panelMessages.importAlertClose}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
