"use client";

import { useMemo, useState, useTransition } from "react";
import Papa from "papaparse";

import { getCsvFieldOptions, getMessages, type Locale } from "@/lib/i18n";

type PreviewRow = Record<string, string>;

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

export function CsvImportPanel({ locale }: { locale: Locale }) {
  const messages = getMessages(locale);
  const panelMessages = messages.imports.panel;
  const csvFieldOptions = getCsvFieldOptions(locale);
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [result, setResult] = useState<string>("");
  const [createMissingVehicles, setCreateMissingVehicles] = useState(true);
  const [isPending, startTransition] = useTransition();

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

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
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
            <button
              disabled={rows.length === 0 || missingRequired.length > 0 || isPending}
              onClick={() => {
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
                  };

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
              }}
              className="w-full rounded-2xl bg-slate-950 px-4 py-3 font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {isPending ? panelMessages.importing : panelMessages.runImport}
            </button>
            {result ? <p className="rounded-2xl bg-slate-100 px-4 py-3 text-slate-700">{result}</p> : null}
          </div>
        </div>
      </section>
    </div>
  );
}
