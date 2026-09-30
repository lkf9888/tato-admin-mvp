"use client";

import { useMemo, useState } from "react";
import { useFormStatus } from "react-dom";

import { saveVehiclePurchasePriceAction } from "@/app/actions";
import { getLocaleTag, type Locale, type Messages } from "@/lib/i18n";
import { cn, formatCurrency, formatCurrencyCompact, formatNumber } from "@/lib/utils";

export type FleetRow = {
  id: string;
  plateNumber: string;
  nickname: string;
  brand: string;
  model: string;
  year: number;
  ownerName: string | null;
  currentMonthRevenue: number;
  trailingTwelveMonthRevenue: number;
  distanceTrackedKm: number;
  revenuePerKm: number | null;
  annualizedReturnPct: number | null;
  purchasePrice: number | null;
  /** Oldest first; the last entry is the current month. */
  months: Array<{ label: string; revenue: number }>;
};

type SortKey =
  | "revenuePerKm"
  | "currentMonthRevenue"
  | "trailingTwelveMonthRevenue"
  | "distanceTrackedKm"
  | "annualizedReturnPct";

/**
 * The fleet as one dense, searchable table.
 *
 * Ranks are taken over the whole fleet *before* the search filter runs,
 * so typing a plate shows where that car actually stands — "#34 of 142"
 * — rather than a meaningless "#1 of the one row you asked for".
 */
export function VehicleRoiFleetTable({
  rows,
  locale,
  copy,
}: {
  rows: FleetRow[];
  locale: Locale;
  copy: Messages["valuation"];
}) {
  const [query, setQuery] = useState("");
  // Per-km was the old page's only ordering; it stays the default.
  const [sortKey, setSortKey] = useState<SortKey>("revenuePerKm");
  const [descending, setDescending] = useState(true);

  const ranked = useMemo(() => {
    const sorted = [...rows].sort((a, b) => {
      const x = a[sortKey];
      const y = b[sortKey];
      // Missing values sink to the bottom whichever way the column is
      // sorted — a car with no distance data is not the "lowest per km".
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return descending ? y - x : x - y;
    });
    return sorted.map((row, index) => ({ row, rank: index + 1 }));
  }, [rows, sortKey, descending]);

  const visible = useMemo(() => {
    // Every word has to appear somewhere, so "toyota 2016" narrows and
    // "tv 951" still finds TV951F.
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return ranked;
    return ranked.filter(({ row }) => {
      const haystack = [
        row.plateNumber,
        row.nickname,
        row.brand,
        row.model,
        String(row.year),
        row.ownerName ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return tokens.every((token) => haystack.includes(token));
    });
  }, [ranked, query]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) setDescending((d) => !d);
    else {
      setSortKey(key);
      setDescending(true);
    }
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--line-strong)] bg-[var(--surface-muted)] px-4 py-8 text-center text-[13px] text-[var(--ink-soft)]">
        {copy.empty}
      </div>
    );
  }

  const numericHeader = (key: SortKey, label: string) => (
    <th className="px-2 py-2 text-right font-semibold">
      <button
        type="button"
        onClick={() => toggleSort(key)}
        className={cn(
          "inline-flex items-center gap-0.5 whitespace-nowrap transition-colors hover:text-[var(--ink)]",
          sortKey === key && "text-[var(--ink)]",
        )}
        aria-sort={sortKey === key ? (descending ? "descending" : "ascending") : undefined}
      >
        {label}
        <span aria-hidden className={cn("text-[9px]", sortKey !== key && "opacity-0")}>
          {descending ? "▼" : "▲"}
        </span>
      </button>
    </th>
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <div className="relative min-w-0 flex-1">
          <svg
            aria-hidden
            viewBox="0 0 20 20"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--ink-soft)]"
          >
            <circle cx="9" cy="9" r="6" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path d="m13.5 13.5 4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={copy.searchPlaceholder}
            aria-label={copy.searchPlaceholder}
            className="h-9 w-full rounded-[var(--control-radius)] border border-[var(--line-strong)] bg-[var(--surface)] pl-9 pr-3 text-[13px] text-[var(--ink)] outline-none transition focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand-soft)]"
          />
        </div>
        <p className="shrink-0 text-[12px] tabular-nums text-[var(--ink-soft)]">
          {copy.searchCount
            .replace("{shown}", String(visible.length))
            .replace("{total}", String(rows.length))}
        </p>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--line-strong)] bg-[var(--surface-muted)] px-4 py-8 text-center text-[13px] text-[var(--ink-soft)]">
          {copy.searchEmpty.replace("{query}", query.trim())}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--line)] bg-[var(--surface)]">
          <table className="w-full min-w-[720px] border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b border-[var(--line)] text-left text-[11px] text-[var(--ink-soft)]">
                <th className="w-7 px-2 py-2 font-semibold">#</th>
                {/* Sticky so the car stays in view while the numbers scroll
                    under it on a phone. */}
                <th className="sticky left-0 z-10 bg-[var(--surface)] px-2 py-2 font-semibold">
                  {copy.colVehicle}
                </th>
                <th className="px-2 py-2 font-semibold">{copy.colTrend}</th>
                {numericHeader("currentMonthRevenue", copy.colMonth)}
                {numericHeader("trailingTwelveMonthRevenue", copy.colTtm)}
                {numericHeader("revenuePerKm", copy.colPerKm)}
                {numericHeader("distanceTrackedKm", copy.colDistance)}
                {numericHeader("annualizedReturnPct", copy.colRoi)}
                <th className="px-2 py-2 text-right font-semibold">{copy.colPrice}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(({ row, rank }) => (
                <tr
                  key={row.id}
                  className="group border-b border-[var(--line)] last:border-b-0 hover:bg-[var(--surface-muted)]"
                >
                  <td className="px-2 py-1.5 text-[11px] tabular-nums text-[var(--ink-soft)]">{rank}</td>
                  {/* Owner rides on the second line instead of taking a
                      column of its own: it is read far less often than the
                      numbers, and the search still matches it. */}
                  <td
                    className="sticky left-0 z-10 w-[210px] max-w-[210px] bg-[var(--surface)] px-2 py-1.5 group-hover:bg-[var(--surface-muted)]"
                    title={`${row.plateNumber} · ${row.nickname}\n${row.year} ${row.brand} ${row.model}\n${row.ownerName ?? copy.unassignedOwner}`}
                  >
                    <p className="truncate font-medium text-[var(--ink)]">
                      {row.plateNumber}
                      {row.nickname && row.nickname !== row.plateNumber ? (
                        <span className="font-normal text-[var(--ink-soft)]"> · {row.nickname}</span>
                      ) : null}
                    </p>
                    <p className="truncate text-[11px] text-[var(--ink-soft)]">
                      {row.year} {row.brand} {row.model}
                      <span className="text-[var(--ink-mid)]"> · {row.ownerName ?? copy.unassignedOwner}</span>
                    </p>
                  </td>
                  <td className="px-2 py-1.5">
                    <Sparkline months={row.months} locale={locale} />
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {formatCurrencyCompact(row.currentMonthRevenue, locale)}
                  </td>
                  <td className="px-2 py-1.5 text-right font-medium tabular-nums">
                    {formatCurrencyCompact(row.trailingTwelveMonthRevenue, locale)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {row.revenuePerKm != null ? formatCurrency(row.revenuePerKm, locale) : "—"}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-[var(--ink-soft)]">
                    {row.distanceTrackedKm > 0 ? `${formatNumber(row.distanceTrackedKm, locale, 0)} km` : "—"}
                  </td>
                  <td
                    className="px-2 py-1.5 text-right font-semibold tabular-nums text-[var(--brand)]"
                    title={row.annualizedReturnPct == null ? copy.roiNeedsPrice : undefined}
                  >
                    {row.annualizedReturnPct != null ? (
                      `${row.annualizedReturnPct.toLocaleString(getLocaleTag(locale), { maximumFractionDigits: 1 })}%`
                    ) : (
                      <span className="font-normal text-[var(--ink-soft)]">—</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    {/* Keyed on the saved value so a successful save, which
                        re-renders the page with the new price, resets the
                        cell rather than leaving it looking unsaved. */}
                    <PriceCell key={`${row.id}:${row.purchasePrice ?? ""}`} row={row} copy={copy} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="px-0.5 text-[11px] leading-4 text-[var(--ink-soft)]">{copy.footnote}</p>
    </div>
  );
}

/**
 * Six months as six bars, scaled to the car's own best month: the shape
 * of its season, not its size — the size is in the columns beside it.
 * The current month is drawn in the brand colour.
 */
function Sparkline({ months, locale }: { months: FleetRow["months"]; locale: Locale }) {
  const max = Math.max(...months.map((m) => m.revenue), 1);
  const detail = months
    .map((m) => `${m.label}  ${formatCurrencyCompact(m.revenue, locale)}`)
    .join("\n");
  return (
    <div className="flex h-6 w-[64px] items-end gap-[3px]" title={detail} aria-label={detail} role="img">
      {months.map((month, index) => (
        <span
          key={month.label}
          className={cn(
            "flex-1 rounded-[1.5px]",
            index === months.length - 1 ? "bg-[var(--brand)]" : "bg-[var(--line-strong)]",
          )}
          style={{ height: `${Math.max((month.revenue / max) * 100, month.revenue > 0 ? 8 : 3)}%` }}
        />
      ))}
    </div>
  );
}

function PriceCell({ row, copy }: { row: FleetRow; copy: Messages["valuation"] }) {
  const saved = row.purchasePrice != null ? String(row.purchasePrice) : "";
  const [value, setValue] = useState(saved);
  const dirty = value.trim() !== saved;

  return (
    <form action={saveVehiclePurchasePriceAction} className="flex items-center justify-end gap-1.5">
      <input type="hidden" name="id" value={row.id} />
      <input
        name="purchasePrice"
        type="number"
        min="0"
        step="100"
        inputMode="decimal"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={copy.pricePlaceholder}
        aria-label={`${copy.colPrice} · ${row.plateNumber}`}
        className="h-7 w-24 rounded-md border border-transparent bg-transparent px-2 text-right text-[12.5px] tabular-nums text-[var(--ink)] outline-none transition placeholder:text-[var(--ink-soft)] hover:border-[var(--line-strong)] focus:border-[var(--brand)] focus:bg-[var(--surface)]"
      />
      {dirty ? <SaveButton copy={copy} /> : null}
    </form>
  );
}

function SaveButton({ copy }: { copy: Messages["valuation"] }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-7 rounded-md bg-[var(--brand)] px-2 text-[11px] font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
    >
      {pending ? copy.priceSaving : copy.priceSave}
    </button>
  );
}
