"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
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
  requiredProjectedPaidSlots: number;
  additionalPaidSlotsNeeded: number;
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
  const [billingNotice, setBillingNotice] = useState("");
  const [billingCheckError, setBillingCheckError] = useState("");
  const [showBillingModal, setShowBillingModal] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [isCheckingBilling, startBillingCheckTransition] = useTransition();

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

    startBillingCheckTransition(async () => {
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
    });
  }, [
    rows,
    mapping,
    createMissingVehicles,
    missingRequired.length,
    panelMessages.billing.genericError,
  ]);

  const activeProjection = billingProjection ?? {
    ...billingSnapshot,
    projectedVehicleCount: billingSnapshot.currentVehicleCount,
    projectedNewVehicleCount: 0,
    requiredProjectedPaidSlots: billingSnapshot.requiredPaidSlots,
    additionalPaidSlotsNeeded: Math.max(
      0,
      billingSnapshot.requiredPaidSlots - billingSnapshot.effectivePurchasedVehicleSlots,
    ),
    exceedsPurchasedLimit: billingSnapshot.isOverLimit,
  };

  const billingPageHref = `/billing?required=${activeProjection.requiredProjectedPaidSlots}&projected=${activeProjection.projectedVehicleCount}&needed=${activeProjection.additionalPaidSlotsNeeded}`;

  function handleImport() {
    if (activeProjection.exceedsPurchasedLimit || billingSnapshot.isOverLimit) {
      setShowBillingModal(true);
      return;
    }

    startTransition(async () => {
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
        }),
      });

      const payload = (await response.json()) as {
        successRows?: number;
        failedRows?: number;
        createdVehicles?: number;
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

      setResult(
        panelMessages.importResult(
          payload.successRows ?? 0,
          payload.createdVehicles ?? 0,
          payload.failedRows ?? 0,
        ),
      );
    });
  }

  return (
    <>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section className="rounded-[1.75rem] border border-white/70 bg-white/90 p-6 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.25em] text-slate-500">
                {panelMessages.uploadKicker}
              </p>
              <h3 className="mt-2 font-serif text-3xl text-slate-950">{panelMessages.uploadTitle}</h3>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <a
                href="https://turo.com/business/earnings"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-900 hover:text-slate-950"
              >
                {panelMessages.openTuroPage}
              </a>
              <label className="inline-flex cursor-pointer items-center rounded-2xl bg-slate-950 px-4 py-3 text-sm font-medium text-white">
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
                        setResult("");
                        setBillingCheckError("");
                      },
                    });
                  }}
                />
              </label>
            </div>
          </div>

          <div className="mt-6 overflow-hidden rounded-3xl border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
              <thead className="bg-slate-50">
                <tr>
                  {headers.map((header) => (
                    <th key={header} className="px-4 py-3 font-semibold text-slate-700">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {previewRows.length > 0 ? (
                  previewRows.map((row, index) => (
                    <tr key={`${index}-${row[headers[0] ?? ""]}`}>
                      {headers.map((header) => (
                        <td key={header} className="px-4 py-3 text-slate-600">
                          {row[header] || "—"}
                        </td>
                      ))}
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="px-4 py-10 text-slate-500" colSpan={Math.max(headers.length, 1)}>
                      {panelMessages.emptyState}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="space-y-5">
          <div className="rounded-[1.75rem] border border-white/70 bg-white/90 p-6 shadow-sm">
            <p className="text-xs uppercase tracking-[0.25em] text-slate-500">
              {panelMessages.billing.kicker}
            </p>
            <h3 className="mt-2 font-serif text-3xl text-slate-950">
              {panelMessages.billing.title}
            </h3>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              {panelMessages.billing.copy}
            </p>

            <div className="mt-5 grid gap-3 rounded-3xl bg-slate-50 p-4 text-sm text-slate-700">
              <div className="flex items-center justify-between">
                <span>{panelMessages.billing.currentVehicles}</span>
                <span className="font-semibold text-slate-950">{billingSnapshot.currentVehicleCount}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>{panelMessages.billing.freeIncluded}</span>
                <span className="font-semibold text-slate-950">{billingSnapshot.freeVehicleSlots}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>{messages.billingPage.couponBonus}</span>
                <span className="font-semibold text-slate-950">{billingSnapshot.bonusVehicleSlots}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>{panelMessages.billing.paidSlots}</span>
                <span className="font-semibold text-slate-950">{billingSnapshot.effectivePurchasedVehicleSlots}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>{panelMessages.billing.allowedTotal}</span>
                <span className="font-semibold text-slate-950">{billingSnapshot.allowedVehicleCount}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>{panelMessages.billing.subscriptionStatus}</span>
                <span className="font-semibold capitalize text-slate-950">{billingSnapshot.status}</span>
              </div>
            </div>

            <div className="mt-5 space-y-3">
              <p className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
                {messages.billingPage.quantityCopy}
              </p>
              {!billingSnapshot.stripeConfigured ? (
                <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-700">
                  {panelMessages.billing.notConfigured}
                </p>
              ) : null}
              {billingSnapshot.billingBypassActive ? (
                <p className="rounded-2xl bg-sky-50 px-4 py-3 text-sm text-sky-800">
                  {messages.billingPage.debugBypassNotice}
                </p>
              ) : null}
              {billingNotice ? (
                <p className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                  {billingNotice}
                </p>
              ) : null}
              <Link
                href={billingPageHref}
                className="block w-full rounded-2xl bg-slate-950 px-4 py-3 text-center font-medium text-white transition hover:bg-slate-800"
              >
                {panelMessages.billing.openBillingPage}
              </Link>
            </div>
          </div>

          <div className="rounded-[1.75rem] border border-white/70 bg-white/90 p-6 shadow-sm">
            <p className="text-xs uppercase tracking-[0.25em] text-slate-500">
              {panelMessages.mappingKicker}
            </p>
            <div className="mt-5 space-y-4">
              {headers.map((header) => (
                <label key={header} className="block space-y-2">
                  <span className="text-sm font-medium text-slate-700">{header}</span>
                  <select
                    value={mapping[header] ?? ""}
                    onChange={(event) =>
                      setMapping((current) => ({
                        ...current,
                        [header]: event.target.value,
                      }))
                    }
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none"
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
          </div>

          <div className="rounded-[1.75rem] border border-white/70 bg-white/90 p-6 shadow-sm">
            <p className="text-xs uppercase tracking-[0.25em] text-slate-500">
              {panelMessages.importKicker}
            </p>
            <div className="mt-4 space-y-4 text-sm text-slate-600">
              <p>
                {panelMessages.rowsDetected}: {rows.length}
              </p>
              <p>
                {panelMessages.requiredMappingLeft}:{" "}
                {missingRequired.length > 0 ? missingRequired.join(", ") : panelMessages.none}
              </p>
              <label className="flex items-start gap-3 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={createMissingVehicles}
                  onChange={(event) => setCreateMissingVehicles(event.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-slate-300"
                />
                <span>
                  {panelMessages.autoCreateTitle}
                  <span className="block text-xs text-slate-500">{panelMessages.autoCreateHint}</span>
                </span>
              </label>

              <div className="rounded-2xl bg-slate-50 px-4 py-3">
                <p className="font-medium text-slate-900">{panelMessages.billing.projectionTitle}</p>
                <p className="mt-2">
                  {panelMessages.billing.projectedVehicles(activeProjection.projectedVehicleCount)}
                </p>
                <p>
                  {panelMessages.billing.projectedNewVehicles(activeProjection.projectedNewVehicleCount)}
                </p>
                <p>
                  {panelMessages.billing.projectedPaidSlots(activeProjection.requiredProjectedPaidSlots)}
                </p>
              </div>

              {isCheckingBilling ? (
                <p className="text-slate-500">{panelMessages.billing.checkingImport}</p>
              ) : null}
              {billingCheckError ? (
                <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {billingCheckError}
                </p>
              ) : null}
              {activeProjection.exceedsPurchasedLimit ? (
                <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-700">
                  {panelMessages.billing.limitExceededDetail(
                    activeProjection.projectedVehicleCount,
                    activeProjection.allowedVehicleCount,
                    activeProjection.additionalPaidSlotsNeeded,
                  )}
                </p>
              ) : null}

              <button
                disabled={rows.length === 0 || missingRequired.length > 0 || isPending}
                onClick={handleImport}
                className="w-full rounded-2xl bg-slate-950 px-4 py-3 font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {isPending ? panelMessages.importing : panelMessages.runImport}
              </button>
              {result ? <p className="rounded-2xl bg-slate-100 px-4 py-3 text-slate-700">{result}</p> : null}
            </div>
          </div>
        </section>
      </div>

      {showBillingModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4">
          <div className="w-full max-w-xl rounded-[1.75rem] border border-white/70 bg-white p-6 shadow-2xl">
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

            <div className="mt-5 grid gap-3 rounded-3xl bg-slate-50 p-4 text-sm text-slate-700">
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

            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => setShowBillingModal(false)}
                className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700"
              >
                {panelMessages.billing.closeModal}
              </button>
              <Link
                href={billingPageHref}
                className="flex-1 rounded-2xl bg-slate-950 px-4 py-3 text-center text-sm font-medium text-white transition hover:bg-slate-800"
              >
                {panelMessages.billing.openBillingPage}
              </Link>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
