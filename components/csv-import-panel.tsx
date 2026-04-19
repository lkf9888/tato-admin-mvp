"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import Papa from "papaparse";

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

type BillingProjection = BillingSnapshot & {
  projectedVehicleCount: number;
  projectedNewVehicleCount: number;
  selectedProjectedNewVehicleCount: number;
  requiredProjectedPaidSlots: number;
  additionalPaidSlotsNeeded: number;
  availableNewVehicleSlots: number;
  selectableVehicleOptions: Array<{
    key: string;
    label: string;
    secondaryLabel: string;
    rowCount: number;
  }>;
  exceedsPurchasedLimit: boolean;
};

const guessField = (header: string) => {
  const normalized = header.trim().toLowerCase();
  if (normalized.includes("reservation") || normalized.includes("trip id")) return "externalOrderId";
  if (normalized === "vehicle") return "vehicleLabel";
  if (normalized === "vehicle name" || normalized === "car") return "vehicleName";
  if (normalized === "vehicle id") return "externalVehicleId";
  if (normalized === "vin") return "vin";
  if (normalized.includes("guest") || normalized.includes("renter")) return "renterName";
  if (normalized.includes("phone")) return "renterPhone";
  if (normalized === "pickup location") return "pickupLocation";
  if (normalized === "return location") return "returnLocation";
  if (normalized.includes("trip start") || normalized === "pickup datetime" || normalized === "pickup time") {
    return "pickupDatetime";
  }
  if (normalized.includes("trip end") || normalized === "return datetime" || normalized === "return time") {
    return "returnDatetime";
  }
  if (normalized === "trip price") return "tripPrice";
  if (normalized === "total earnings") return "totalEarnings";
  if (normalized.includes("earning") || normalized.includes("price")) return "totalPrice";
  if (normalized.includes("trip status") || normalized.includes("status")) return "status";
  return "";
};

export function CsvImportPanel({
  locale,
  billingSnapshot,
  billingState,
}: {
  locale: Locale;
  billingSnapshot: BillingSnapshot;
  billingState: string | null;
}) {
  const messages = getMessages(locale);
  const panelMessages = messages.imports.panel;
  const csvFieldOptions = getCsvFieldOptions(locale);
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [result, setResult] = useState("");
  const [createMissingVehicles, setCreateMissingVehicles] = useState(true);
  const [billingProjection, setBillingProjection] = useState<BillingProjection | null>(null);
  const [selectedVehicleKeys, setSelectedVehicleKeys] = useState<string[]>([]);
  const [billingNotice, setBillingNotice] = useState("");
  const [billingCheckError, setBillingCheckError] = useState("");
  const [showBillingModal, setShowBillingModal] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isCheckingBilling, setIsCheckingBilling] = useState(false);

  const previewRows = useMemo(() => rows.slice(0, 5), [rows]);

  const mappedFields = Object.values(mapping).filter(Boolean);
  const fieldLabels = Object.fromEntries(csvFieldOptions.map((option) => [option.value, option.label]));
  const missingRequired = [
    !["vehicleLabel", "vehicleName", "externalVehicleId", "vin"].some((field) =>
      mappedFields.includes(field),
    )
      ? panelMessages.oneVehicleIdentifier
      : null,
    !mappedFields.includes("renterName") ? fieldLabels.renterName : null,
    !mappedFields.includes("pickupDatetime") ? fieldLabels.pickupDatetime : null,
    !mappedFields.includes("returnDatetime") ? fieldLabels.returnDatetime : null,
  ].filter(Boolean);

  useEffect(() => {
    if (billingState === "success") {
      setBillingNotice(panelMessages.billing.checkoutSuccess);
    } else if (billingState === "cancelled") {
      setBillingNotice(panelMessages.billing.checkoutCancelled);
    } else if (billingState === "updated") {
      setBillingNotice(panelMessages.billing.checkoutUpdated);
    }
  }, [billingState, panelMessages.billing]);

  useEffect(() => {
    if (rows.length === 0 || missingRequired.length > 0) {
      setBillingProjection(null);
      setBillingCheckError("");
      return;
    }

    let cancelled = false;
    setIsCheckingBilling(true);

    void (async () => {
      try {
        const response = await fetch("/api/billing/import-check", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            rows,
            mapping,
            createMissingVehicles,
          }),
        });

        const payload = (await response.json()) as BillingProjection & { error?: string };

        if (cancelled) return;

        if (!response.ok) {
          setBillingProjection(null);
          setBillingCheckError(payload.error ?? panelMessages.billing.genericError);
          return;
        }

        setBillingProjection(payload);
        setBillingCheckError("");

        if (payload.exceedsPurchasedLimit) {
          setShowBillingModal(true);
        }
      } finally {
        if (!cancelled) {
          setIsCheckingBilling(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    rows,
    mapping,
    createMissingVehicles,
    missingRequired.length,
    panelMessages.billing.genericError,
  ]);

  useEffect(() => {
    if (
      !billingProjection ||
      billingProjection.selectableVehicleOptions.length === 0 ||
      billingProjection.availableNewVehicleSlots < 1
    ) {
      return;
    }

    setSelectedVehicleKeys((current) => {
      const validCurrent = current.filter((key) =>
        billingProjection.selectableVehicleOptions.some((vehicle) => vehicle.key === key),
      );

      if (validCurrent.length > 0) {
        return validCurrent.slice(0, billingProjection.availableNewVehicleSlots);
      }

      return billingProjection.selectableVehicleOptions
        .slice(0, billingProjection.availableNewVehicleSlots)
        .map((vehicle) => vehicle.key);
    });
  }, [billingProjection]);

  const activeProjection = useMemo(() => {
    if (!billingProjection) {
      return {
        ...billingSnapshot,
        projectedVehicleCount: billingSnapshot.currentVehicleCount,
        projectedNewVehicleCount: 0,
        requiredProjectedPaidSlots: billingSnapshot.requiredPaidSlots,
        additionalPaidSlotsNeeded: Math.max(
          0,
          billingSnapshot.requiredPaidSlots - billingSnapshot.effectivePurchasedVehicleSlots,
        ),
        selectedProjectedNewVehicleCount: 0,
        availableNewVehicleSlots: Math.max(
          0,
          billingSnapshot.allowedVehicleCount - billingSnapshot.currentVehicleCount,
        ),
        selectableVehicleOptions: [],
        exceedsPurchasedLimit: billingSnapshot.isOverLimit,
      };
    }

    if (billingProjection.selectableVehicleOptions.length === 0) {
      return billingProjection;
    }

    const validSelectedVehicleCount = selectedVehicleKeys.filter((key) =>
      billingProjection.selectableVehicleOptions.some((vehicle) => vehicle.key === key),
    ).length;
    const selectedProjectedNewVehicleCount =
      validSelectedVehicleCount > 0
        ? Math.min(validSelectedVehicleCount, billingProjection.availableNewVehicleSlots)
        : 0;
    const projectedVehicleCount =
      billingSnapshot.currentVehicleCount + selectedProjectedNewVehicleCount;
    const requiredProjectedPaidSlots = Math.max(
      0,
      projectedVehicleCount - billingSnapshot.freeVehicleSlots - billingSnapshot.bonusVehicleSlots,
    );
    const additionalPaidSlotsNeeded = Math.max(
      0,
      requiredProjectedPaidSlots - billingSnapshot.effectivePurchasedVehicleSlots,
    );

    return {
      ...billingProjection,
      projectedVehicleCount,
      selectedProjectedNewVehicleCount,
      requiredProjectedPaidSlots,
      additionalPaidSlotsNeeded,
      exceedsPurchasedLimit: billingSnapshot.billingBypassActive
        ? false
        : projectedVehicleCount > billingSnapshot.allowedVehicleCount,
    };
  }, [billingProjection, billingSnapshot, selectedVehicleKeys]);

  const billingPageHref = `/billing?required=${activeProjection.requiredProjectedPaidSlots}&projected=${activeProjection.projectedVehicleCount}&needed=${activeProjection.additionalPaidSlotsNeeded}`;

  function submitImport(options?: { skipLimitGuard?: boolean }) {
    if (!options?.skipLimitGuard && (activeProjection.exceedsPurchasedLimit || billingSnapshot.isOverLimit)) {
      setShowBillingModal(true);
      return;
    }

    setIsImporting(true);
    void (async () => {
      try {
        const response = await fetch("/api/imports", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            fileName,
            mapping,
            rows,
            createMissingVehicles,
            selectedVehicleKeys,
          }),
        });

        const payload = (await response.json()) as {
          successRows?: number;
          failedRows?: number;
          createdVehicles?: number;
          skippedRows?: number;
          error?: string;
          details?: BillingProjection;
        };

        const billingDetails = payload.details;

        if (response.status === 402 && billingDetails) {
          setBillingProjection(billingDetails);
          setShowBillingModal(true);
          setResult(payload.error ?? panelMessages.billing.limitExceeded);
          return;
        }

        if (!response.ok) {
          setResult(payload.error ?? panelMessages.genericFailure);
          return;
        }

        setShowBillingModal(false);
        setResult(
          panelMessages.importResult(
            payload.successRows ?? 0,
            payload.createdVehicles ?? 0,
            payload.failedRows ?? 0,
            payload.skippedRows ?? 0,
          ),
        );
      } finally {
        setIsImporting(false);
      }
    })();
  }

  function toggleVehicleSelection(vehicleKey: string) {
    setSelectedVehicleKeys((current) => {
      const exists = current.includes(vehicleKey);
      if (exists) {
        return current.filter((key) => key !== vehicleKey);
      }

      if (current.length >= activeProjection.availableNewVehicleSlots) {
        return current;
      }

      return [...current, vehicleKey];
    });
  }

  const importMessages = messages.imports;
  const hasFile = rows.length > 0;
  const readyToImport = hasFile && missingRequired.length === 0;

  return (
    <>
      <section className="rounded-lg border border-[color:var(--line)] bg-white px-6 py-5 shadow-[0_20px_50px_-40px_rgba(17,19,24,0.4)]">
        <div className="flex flex-col gap-1">
          <p className="text-[11px] uppercase tracking-[0.22em] text-[color:var(--ink-soft)]">
            {importMessages.pageKicker}
          </p>
          <h2 className="font-serif text-[1.8rem] leading-tight text-[color:var(--ink)]">
            {importMessages.pageTitle}
          </h2>
          <p className="text-sm text-[color:var(--ink-soft)]">{importMessages.pageSubtitle}</p>
        </div>

        <div className="mt-5 border-t border-[color:var(--line)] pt-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--ink-soft)]">
            {importMessages.guideTitle}
          </p>
          <ol className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {importMessages.guideSteps.map((step, index) => (
              <li
                key={step.title}
                className="flex gap-3 rounded-md border border-[color:var(--line)] bg-[var(--surface-muted)] px-3 py-3"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--ink)] text-xs font-semibold text-white tabular-nums">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-[color:var(--ink)]">{step.title}</p>
                  <p className="mt-1 text-[12px] leading-5 text-[color:var(--ink-soft)]">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <section className="rounded-lg border border-[color:var(--line)] bg-white px-5 py-4 shadow-[0_20px_50px_-40px_rgba(17,19,24,0.4)]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--ink)] text-xs font-semibold text-white">
                  1
                </span>
                <div>
                  <h3 className="text-[15px] font-semibold text-[color:var(--ink)]">
                    {panelMessages.uploadTitle}
                  </h3>
                  <p className="text-[12px] text-[color:var(--ink-soft)]">
                    {fileName ? fileName : panelMessages.emptyState}
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
                <label className="inline-flex cursor-pointer items-center rounded-md bg-[var(--ink)] px-3 py-2 text-[13px] font-medium text-white transition hover:bg-[color:rgba(18,18,20,0.85)]">
                  {panelMessages.chooseFile}
                  <input
                    type="file"
                    accept=".csv"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (!file) return;
                      setFileName(file.name);
                      Papa.parse<PreviewRow>(file, {
                        header: true,
                        skipEmptyLines: true,
                        complete: (results) => {
                          const nextHeaders = results.meta.fields ?? [];
                          setHeaders(nextHeaders);
                          setRows(results.data);
                          const guessedMapping = Object.fromEntries(
                            nextHeaders.map((header) => [header, guessField(header)]),
                          );
                          setMapping(guessedMapping);
                          setSelectedVehicleKeys([]);
                          setBillingProjection(null);
                          setShowBillingModal(false);
                          setResult("");
                          setBillingCheckError("");
                        },
                      });
                    }}
                  />
                </label>
              </div>
            </div>

            {hasFile ? (
              <div className="mt-4 overflow-x-auto rounded-md border border-[color:var(--line)]">
                <table className="min-w-full divide-y divide-[color:var(--line)] text-left text-[12px]">
                  <thead className="bg-[var(--surface-muted)]">
                    <tr>
                      {headers.map((header) => (
                        <th
                          key={header}
                          className="whitespace-nowrap px-3 py-2 font-semibold text-[color:var(--ink)]"
                        >
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[color:var(--line)] bg-white">
                    {previewRows.map((row, index) => (
                      <tr key={`${index}-${row[headers[0] ?? ""]}`}>
                        {headers.map((header) => (
                          <td
                            key={header}
                            className="whitespace-nowrap px-3 py-2 text-[color:var(--ink-soft)]"
                          >
                            {row[header] || "—"}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>

          <section
            className={`rounded-lg border border-[color:var(--line)] bg-white px-5 py-4 shadow-[0_20px_50px_-40px_rgba(17,19,24,0.4)] transition ${
              hasFile ? "" : "opacity-60"
            }`}
          >
            <div className="flex items-center gap-3">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--ink)] text-xs font-semibold text-white">
                2
              </span>
              <div className="flex-1">
                <h3 className="text-[15px] font-semibold text-[color:var(--ink)]">
                  {panelMessages.mappingKicker}
                </h3>
                <p className="text-[12px] text-[color:var(--ink-soft)]">
                  {hasFile
                    ? missingRequired.length > 0
                      ? `${panelMessages.requiredMappingLeft}: ${missingRequired.join(", ")}`
                      : `${panelMessages.requiredMappingLeft}: ${panelMessages.none}`
                    : panelMessages.emptyState}
                </p>
              </div>
            </div>

            {hasFile ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {headers.map((header) => (
                  <label key={header} className="block space-y-1">
                    <span className="text-[12px] font-medium text-[color:var(--ink)]">{header}</span>
                    <select
                      value={mapping[header] ?? ""}
                      onChange={(event) =>
                        setMapping((current) => ({
                          ...current,
                          [header]: event.target.value,
                        }))
                      }
                      className="h-9 w-full rounded-md border border-[color:var(--line)] bg-white px-2 text-[13px] text-[color:var(--ink)] outline-none focus:border-[var(--ink)]"
                    >
                      <option value="">{panelMessages.ignoreColumn}</option>
                      {csvFieldOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            ) : null}
          </section>

          <section
            className={`rounded-lg border border-[color:var(--line)] bg-white px-5 py-4 shadow-[0_20px_50px_-40px_rgba(17,19,24,0.4)] transition ${
              readyToImport ? "" : "opacity-60"
            }`}
          >
            <div className="flex items-center gap-3">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--ink)] text-xs font-semibold text-white">
                3
              </span>
              <div className="flex-1">
                <h3 className="text-[15px] font-semibold text-[color:var(--ink)]">
                  {panelMessages.importKicker}
                </h3>
                <p className="text-[12px] text-[color:var(--ink-soft)]">
                  {panelMessages.rowsDetected}: {rows.length}
                </p>
              </div>
            </div>

            <div className="mt-4 space-y-3 text-[13px] text-[color:var(--ink)]">
              <label className="flex items-start gap-3 rounded-md border border-[color:var(--line)] bg-[var(--surface-muted)] px-3 py-2 text-[13px]">
                <input
                  type="checkbox"
                  checked={createMissingVehicles}
                  onChange={(event) => {
                    setCreateMissingVehicles(event.target.checked);
                    if (!event.target.checked) {
                      setSelectedVehicleKeys([]);
                    }
                  }}
                  className="mt-0.5 h-4 w-4 rounded border-[color:var(--line)]"
                />
                <span>
                  <span className="font-medium text-[color:var(--ink)]">
                    {panelMessages.autoCreateTitle}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-[color:var(--ink-soft)]">
                    {panelMessages.autoCreateHint}
                  </span>
                </span>
              </label>

              {hasFile ? (
                <div className="rounded-md border border-[color:var(--line)] bg-[var(--surface-muted)] px-3 py-2 text-[12px] text-[color:var(--ink-soft)]">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--ink)]">
                    {panelMessages.billing.projectionTitle}
                  </p>
                  <div className="mt-1 grid gap-0.5 sm:grid-cols-3">
                    <p>
                      {panelMessages.billing.projectedVehicles(activeProjection.projectedVehicleCount)}
                    </p>
                    <p>
                      {panelMessages.billing.projectedNewVehicles(
                        activeProjection.projectedNewVehicleCount,
                      )}
                    </p>
                    <p>
                      {panelMessages.billing.projectedPaidSlots(
                        activeProjection.requiredProjectedPaidSlots,
                      )}
                    </p>
                  </div>
                  {activeProjection.selectableVehicleOptions.length > 0 ? (
                    <p className="mt-1 text-[color:var(--ink)]">
                      {panelMessages.selectedVehiclesSummary(
                        selectedVehicleKeys.length,
                        activeProjection.availableNewVehicleSlots,
                      )}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {isCheckingBilling ? (
                <p className="text-[12px] text-[color:var(--ink-soft)]">
                  {panelMessages.billing.checkingImport}
                </p>
              ) : null}
              {billingCheckError ? (
                <p className="rounded-md bg-rose-50 px-3 py-2 text-[12px] text-rose-700">
                  {billingCheckError}
                </p>
              ) : null}
              {activeProjection.exceedsPurchasedLimit ? (
                <p className="rounded-md bg-amber-50 px-3 py-2 text-[12px] text-amber-700">
                  {panelMessages.billing.limitExceededDetail(
                    activeProjection.projectedVehicleCount,
                    activeProjection.allowedVehicleCount,
                    activeProjection.additionalPaidSlotsNeeded,
                  )}
                </p>
              ) : null}

              <button
                disabled={!readyToImport || isImporting}
                onClick={() => submitImport()}
                className="w-full rounded-md bg-[var(--accent)] px-4 py-2.5 text-[14px] font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:bg-[color:var(--line)] disabled:text-[color:var(--ink-soft)]"
              >
                {isImporting ? panelMessages.importing : panelMessages.runImport}
              </button>
              {result ? (
                <p className="rounded-md bg-[var(--surface-muted)] px-3 py-2 text-[12px] text-[color:var(--ink)]">
                  {result}
                </p>
              ) : null}
            </div>
          </section>
        </div>

        <aside className="space-y-4">
          <section className="rounded-lg border border-[color:var(--line)] bg-white px-5 py-4 shadow-[0_20px_50px_-40px_rgba(17,19,24,0.4)]">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[11px] font-semibold text-[var(--accent)]">
                0
              </span>
              <h3 className="text-[14px] font-semibold text-[color:var(--ink)]">
                {panelMessages.billing.title}
              </h3>
            </div>
            <p className="mt-2 text-[12px] leading-5 text-[color:var(--ink-soft)]">
              {panelMessages.billing.copy}
            </p>

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
                <dt className="text-[color:var(--ink-soft)]">
                  {panelMessages.billing.subscriptionStatus}
                </dt>
                <dd className="font-semibold capitalize text-[color:var(--ink)]">
                  {billingSnapshot.status}
                </dd>
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
                <p className="rounded-md bg-emerald-50 px-3 py-2 text-[12px] text-emerald-700">
                  {billingNotice}
                </p>
              ) : null}
              <Link
                href={billingPageHref}
                className="block w-full rounded-md bg-[var(--ink)] px-3 py-2 text-center text-[13px] font-medium text-white transition hover:bg-[color:rgba(18,18,20,0.85)]"
              >
                {panelMessages.billing.openBillingPage}
              </Link>
            </div>
          </section>
        </aside>
      </div>

      {showBillingModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4">
          <div className="w-full max-w-xl rounded-lg border border-white/70 bg-white p-6 shadow-2xl">
            <p className="text-xs uppercase tracking-[0.25em] text-slate-500">
              {panelMessages.billing.modalKicker}
            </p>
            <h3 className="mt-2 font-serif text-3xl text-slate-950">
              {panelMessages.billing.modalTitle}
            </h3>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              {panelMessages.billing.modalCopy(
                activeProjection.projectedVehicleCount,
                activeProjection.allowedVehicleCount,
              )}
            </p>

            <div className="mt-5 grid gap-3 rounded-lg bg-slate-50 p-4 text-sm text-slate-700">
              <div className="flex items-center justify-between">
                <span>{panelMessages.billing.currentVehicles}</span>
                <span className="font-semibold text-slate-950">{billingSnapshot.currentVehicleCount}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>{panelMessages.billing.projectedVehiclesLabel}</span>
                <span className="font-semibold text-slate-950">{activeProjection.projectedVehicleCount}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>{panelMessages.billing.additionalNeededLabel}</span>
                <span className="font-semibold text-slate-950">{activeProjection.additionalPaidSlotsNeeded}</span>
              </div>
            </div>

            {activeProjection.selectableVehicleOptions.length > 0 ? (
              <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                  {panelMessages.chooseVehiclesLabel}
                </p>
                <h4 className="mt-2 text-base font-semibold text-slate-950">
                  {panelMessages.chooseVehiclesTitle}
                </h4>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  {panelMessages.chooseVehiclesCopy(activeProjection.availableNewVehicleSlots)}
                </p>
                <p className="mt-3 text-xs text-slate-500">
                  {panelMessages.selectionLimitNotice(activeProjection.availableNewVehicleSlots)}
                </p>

                <div className="mt-4 max-h-72 space-y-2 overflow-y-auto pr-1">
                  {activeProjection.selectableVehicleOptions.map((vehicle) => {
                    const checked = selectedVehicleKeys.includes(vehicle.key);
                    const disableUnchecked =
                      !checked && selectedVehicleKeys.length >= activeProjection.availableNewVehicleSlots;

                    return (
                      <label
                        key={vehicle.key}
                        className={`flex cursor-pointer items-start gap-3 rounded-md border px-4 py-3 transition ${
                          checked
                            ? "border-slate-950 bg-white"
                            : "border-slate-200 bg-white/75"
                        } ${disableUnchecked ? "opacity-60" : ""}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={disableUnchecked}
                          onChange={() => toggleVehicleSelection(vehicle.key)}
                          className="mt-1 h-4 w-4 rounded border-slate-300"
                        />
                        <span className="block min-w-0">
                          <span className="block text-sm font-medium text-slate-950">{vehicle.label}</span>
                          <span className="mt-1 block text-xs text-slate-500">
                            {vehicle.secondaryLabel || "—"} · {vehicle.rowCount} row(s)
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>

                {activeProjection.availableNewVehicleSlots < 1 ? (
                  <p className="mt-4 rounded-md bg-white px-4 py-3 text-sm text-slate-600">
                    {panelMessages.selectionNoneAvailable}
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => setShowBillingModal(false)}
                className="rounded-md border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700"
              >
                {panelMessages.billing.closeModal}
              </button>
              <Link
                href={billingPageHref}
                className="flex-1 rounded-md bg-slate-950 px-4 py-3 text-center text-sm font-medium text-white transition hover:bg-slate-800"
              >
                {panelMessages.billing.openBillingPage}
              </Link>
              {activeProjection.selectableVehicleOptions.length > 0 ? (
                <button
                  type="button"
                  disabled={isImporting || selectedVehicleKeys.length === 0}
                  onClick={() => submitImport({ skipLimitGuard: true })}
                  className="flex-1 rounded-md bg-white px-4 py-3 text-center text-sm font-medium text-slate-950 ring-1 ring-slate-200 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                >
                  {panelMessages.importSelectedAction}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
