"use client";

import { useMemo, useState } from "react";

import { getLocaleTag, type Locale, type Messages } from "@/lib/i18n";
import { DEFAULT_FIXED_COSTS } from "@/lib/rental-estimate/costs";
import {
  overrideKey,
  rankVehicles,
  type FixedCosts,
  type RankedVehicle,
  type RankingOptions,
} from "@/lib/rental-estimate/roi";
import { cn, formatCurrencyCompact } from "@/lib/utils";

function fill(template: string, values: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}

const ROW_LIMIT = 40;

export function InvestmentRankingTool({
  locale,
  copy,
}: {
  locale: Locale;
  copy: Messages["investmentRanking"];
}) {
  const now = useMemo(() => new Date().getFullYear(), []);
  const money = (value: number) => formatCurrencyCompact(value, locale);
  // Whole percent only. These figures carry a ±20% band; a decimal place
  // would claim precision the model does not have.
  const percent = (value: number) => `${Math.round(value * 100)}%`;

  const [budget, setBudget] = useState(60000);
  const [ownerView, setOwnerView] = useState(false);
  const [commission, setCommission] = useState(30);
  const [sortBy, setSortBy] = useState<RankingOptions["sortBy"]>("totalRoi");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [fixed, setFixed] = useState<FixedCosts>({ ...DEFAULT_FIXED_COSTS });
  const [assumptionsOpen, setAssumptionsOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, number>>({});

  const effectiveCommission = ownerView ? commission / 100 : 0;

  // ~3,300 car-years, each a dozen months of arithmetic. Cheap enough to
  // redo on every keystroke, but not cheap enough to redo on every
  // render, so it hangs off the inputs that actually change it.
  const { rows, scored, positive, robust } = useMemo(() => {
    const all = rankVehicles({
      now,
      commission: effectiveCommission,
      fixed,
      budget,
      sortBy,
      overrides,
      minPrice: minPrice ? Number(minPrice) : undefined,
      maxPrice: maxPrice ? Number(maxPrice) : undefined,
    });
    // A car you typed a real price for is the car you are actually
    // considering. Left to the plain cut-off it vanishes the moment the
    // price you entered makes it a bad deal — which is exactly the
    // answer you were looking for, and exactly when you lose sight of
    // it. Overridden rows stay visible, carrying their true rank.
    const top = all.slice(0, ROW_LIMIT);
    const shown = new Set(top.map((r) => overrideKey(r.make, r.model, r.year)));
    const pinned = all
      .map((r, index) => ({ row: r, rank: index + 1 }))
      .filter(
        ({ row }) =>
          row.priceIsOverride && !shown.has(overrideKey(row.make, row.model, row.year)),
      );

    return {
      rows: top.map((row, index) => ({ row, rank: index + 1 })).concat(pinned),
      scored: all.length,
      positive: all.filter((r) => r.totalReturn > 0).length,
      robust: all.filter((r) => r.scenarios.worst.totalReturn > 0).length,
    };
  }, [now, effectiveCommission, fixed, budget, sortBy, overrides, minPrice, maxPrice]);

  const inputClass =
    "h-10 w-full rounded-[var(--control-radius)] border border-[var(--line-strong)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] outline-none transition focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand-soft)]";
  const labelClass =
    "mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-soft)]";
  const card =
    "rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface)] shadow-[0_1px_2px_rgba(17,19,24,0.04)]";

  return (
    <div className="space-y-3">
      {/* ---------- controls ---------- */}
      <div className={cn(card, "p-4 sm:p-5")}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className={labelClass} htmlFor="ir-budget">
              {copy.budgetLabel}
            </label>
            <input
              id="ir-budget"
              type="number"
              min={5000}
              step={5000}
              className={inputClass}
              value={budget}
              onChange={(event) => setBudget(Math.max(0, Number(event.target.value)))}
            />
            <p className="mt-1 text-[11px] leading-4 text-[var(--ink-soft)]">{copy.budgetHint}</p>
          </div>

          <div>
            <span className={labelClass}>{copy.perspectiveLabel}</span>
            <div className="flex rounded-[var(--control-radius)] border border-[var(--line-strong)] p-0.5">
              {[
                [false, copy.perspectiveTato],
                [true, copy.perspectiveOwner],
              ].map(([value, label]) => (
                <button
                  key={String(value)}
                  type="button"
                  onClick={() => setOwnerView(value as boolean)}
                  className={cn(
                    "flex-1 rounded-[6px] px-2 py-2 text-[12px] font-medium leading-tight transition",
                    ownerView === value
                      ? "bg-[var(--ink)] text-white"
                      : "text-[var(--ink-mid)] hover:bg-[var(--accent-soft)]",
                  )}
                >
                  {label as string}
                </button>
              ))}
            </div>
            {ownerView ? (
              <div className="mt-2 flex items-center gap-3">
                <input
                  type="range"
                  min={0}
                  max={50}
                  value={commission}
                  onChange={(event) => setCommission(Number(event.target.value))}
                  className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-[var(--accent-soft-strong)] accent-[var(--brand)]"
                  aria-label={copy.commissionLabel}
                />
                <span className="text-[12px] font-semibold tabular-nums text-[var(--ink)]">
                  {commission}%
                </span>
              </div>
            ) : null}
          </div>

          <div>
            <label className={labelClass} htmlFor="ir-sort">
              {copy.sortLabel}
            </label>
            <select
              id="ir-sort"
              className={inputClass}
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value as RankingOptions["sortBy"])}
            >
              <option value="totalRoi">{copy.sortTotalRoi}</option>
              <option value="cashYield">{copy.sortCashYield}</option>
              <option value="netCash">{copy.sortNetCash}</option>
              <option value="budgetReturn">{copy.sortBudgetReturn}</option>
            </select>
          </div>

          <div>
            <span className={labelClass}>{copy.priceRangeLabel}</span>
            <div className="flex gap-2">
              <input
                type="number"
                placeholder={copy.minPrice}
                className={inputClass}
                value={minPrice}
                onChange={(event) => setMinPrice(event.target.value)}
              />
              <input
                type="number"
                placeholder={copy.maxPrice}
                className={inputClass}
                value={maxPrice}
                onChange={(event) => setMaxPrice(event.target.value)}
              />
            </div>
          </div>
        </div>

        {/* assumptions */}
        <div className="mt-4 border-t border-[var(--line)] pt-3">
          <button
            type="button"
            onClick={() => setAssumptionsOpen((open) => !open)}
            aria-expanded={assumptionsOpen}
            className="text-[13px] font-medium text-[var(--brand)]"
          >
            {copy.assumptionsToggle} {assumptionsOpen ? "▾" : "▸"}
          </button>
          {assumptionsOpen ? (
            <div className="mt-3">
              <div className="grid gap-3 sm:grid-cols-3">
                {(
                  [
                    ["insurance", copy.insuranceLabel],
                    ["parking", copy.parkingLabel],
                    ["licensing", copy.licensingLabel],
                  ] as const
                ).map(([key, label]) => (
                  <div key={key}>
                    <label className={labelClass} htmlFor={`ir-${key}`}>
                      {label}
                    </label>
                    <input
                      id={`ir-${key}`}
                      type="number"
                      min={0}
                      step={100}
                      className={inputClass}
                      value={fixed[key]}
                      onChange={(event) =>
                        setFixed((current) => ({
                          ...current,
                          [key]: Math.max(0, Number(event.target.value)),
                        }))
                      }
                    />
                  </div>
                ))}
              </div>
              <p className="mt-2.5 text-[12px] leading-5 text-[var(--ink-soft)]">
                {copy.assumptionsNote}
              </p>
              <button
                type="button"
                onClick={() => setFixed({ ...DEFAULT_FIXED_COSTS })}
                className="mt-2 text-[12px] font-medium text-[var(--brand)]"
              >
                {copy.resetAssumptions}
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <p className="px-1 text-[12px] leading-5 text-[var(--ink-soft)] tabular-nums">
        {fill(copy.summaryScored, {
          scored: scored.toLocaleString(getLocaleTag(locale)),
          positive: positive.toLocaleString(getLocaleTag(locale)),
          robust: robust.toLocaleString(getLocaleTag(locale)),
        })}
      </p>

      {/* ---------- table ---------- */}
      {rows.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--line-strong)] bg-[var(--surface-muted)] px-6 py-12 text-center">
          <p className="text-base font-semibold text-[var(--ink)]">{copy.emptyTitle}</p>
          <p className="mt-1.5 text-sm text-[var(--ink-soft)]">{copy.emptyCopy}</p>
        </div>
      ) : (
        <div className={cn(card, "overflow-hidden")}>
          {/* Wide table, narrow phones: the table scrolls inside its own
              box rather than pushing the page sideways. */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-[var(--line)] text-left text-[11px] uppercase tracking-[0.1em] text-[var(--ink-soft)]">
                  <th className="px-3 py-2.5 font-semibold">{copy.colRank}</th>
                  <th className="px-3 py-2.5 font-semibold">{copy.colVehicle}</th>
                  <th className="px-3 py-2.5 text-right font-semibold">{copy.colPrice}</th>
                  <th className="px-3 py-2.5 text-right font-semibold">{copy.colRevenue}</th>
                  <th className="px-3 py-2.5 text-right font-semibold">{copy.colCosts}</th>
                  <th className="px-3 py-2.5 text-right font-semibold">{copy.colNet}</th>
                  <th className="px-3 py-2.5 text-right font-semibold">{copy.colRoi}</th>
                  <th className="px-3 py-2.5 text-right font-semibold">{copy.colRange}</th>
                  <th className="px-3 py-2.5 text-right font-semibold">{copy.colUnits}</th>
                  <th className="px-3 py-2.5 text-right font-semibold">{copy.colBudgetReturn}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ row, rank }) => {
                  const key = overrideKey(row.make, row.model, row.year);
                  const open = expanded === key;
                  return (
                    <RankRow
                      key={key}
                      row={row}
                      rank={rank}
                      open={open}
                      onToggle={() => setExpanded(open ? null : key)}
                      copy={copy}
                      money={money}
                      percent={percent}
                      locale={locale}
                      ownerView={ownerView}
                      override={overrides[key]}
                      onOverride={(value) =>
                        setOverrides((current) => {
                          const next = { ...current };
                          if (value == null) delete next[key];
                          else next[key] = value;
                          return next;
                        })
                      }
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ---------- caveats ---------- */}
      <div className="rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface-muted)] p-4 sm:p-5">
        <p className="text-[13px] font-semibold text-[var(--ink)]">{copy.cautionTitle}</p>
        <ul className="mt-2 space-y-1.5">
          {[copy.caution1, copy.caution2, copy.caution3, copy.caution4].map((item) => (
            <li key={item} className="flex gap-2 text-[12px] leading-5 text-[var(--ink-soft)]">
              <span aria-hidden className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[var(--line-strong)]" />
              {item}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function RankRow({
  row,
  rank,
  open,
  onToggle,
  copy,
  money,
  percent,
  locale,
  ownerView,
  override,
  onOverride,
}: {
  row: RankedVehicle;
  rank: number;
  open: boolean;
  onToggle: () => void;
  copy: Messages["investmentRanking"];
  money: (value: number) => string;
  percent: (value: number) => string;
  locale: Locale;
  ownerView: boolean;
  override?: number;
  onOverride: (value: number | null) => void;
}) {
  const runningCosts = row.maintenance + row.repairs + row.fixedTotal;
  const lines: Array<[string, string, boolean?]> = [
    [copy.detailRevenue, money(row.grossRevenue)],
    ...(ownerView
      ? ([[copy.detailCommission, `− ${money(row.grossRevenue - row.revenue)}`]] as Array<
          [string, string]
        >)
      : []),
    [copy.detailMaintenance, `− ${money(row.maintenance)}`],
    [copy.detailRepairs, `− ${money(row.repairs)}`],
    [copy.detailFixed, `− ${money(row.fixedTotal)}`],
    [copy.detailNetCash, money(row.netCash), true],
    [copy.detailDepreciation, `− ${money(row.depreciation)}`],
    [copy.detailTotal, money(row.totalReturn), true],
  ];

  return (
    <>
      <tr
        onClick={onToggle}
        className={cn(
          "cursor-pointer border-b border-[var(--line)] transition-colors",
          open ? "bg-[var(--brand-soft)]" : "hover:bg-[var(--surface-muted)]",
        )}
      >
        <td className="px-3 py-2.5 text-[var(--ink-soft)] tabular-nums">{rank}</td>
        <td className="px-3 py-2.5">
          <span className="font-medium text-[var(--ink)]">
            {row.year} {row.make} {row.model}
          </span>
          {row.priceIsOverride ? (
            <span className="ml-2 rounded-[var(--radius-pill)] bg-[var(--brand-soft)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--brand)]">
              ✎
            </span>
          ) : null}
        </td>
        <td className="px-3 py-2.5 text-right tabular-nums">{money(row.price)}</td>
        <td className="px-3 py-2.5 text-right tabular-nums">{money(row.revenue)}</td>
        <td className="px-3 py-2.5 text-right text-[var(--ink-soft)] tabular-nums">
          − {money(runningCosts)}
        </td>
        <td className="px-3 py-2.5 text-right font-medium tabular-nums">{money(row.netCash)}</td>
        <td
          className={cn(
            "px-3 py-2.5 text-right font-semibold tabular-nums",
            row.totalRoi > 0 ? "text-[var(--brand)]" : "text-[var(--bad-fg)]",
          )}
        >
          {percent(row.totalRoi)}
        </td>
        <td className="px-3 py-2.5 text-right text-[12px] text-[var(--ink-soft)] tabular-nums">
          {percent(row.scenarios.worst.totalRoi)} – {percent(row.scenarios.best.totalRoi)}
        </td>
        <td className="px-3 py-2.5 text-right tabular-nums">{row.unitsForBudget || "—"}</td>
        <td className="px-3 py-2.5 text-right tabular-nums">
          {row.unitsForBudget ? money(row.budgetTotalReturn) : "—"}
        </td>
      </tr>

      {open ? (
        <tr className="border-b border-[var(--line)] bg-[var(--surface-muted)]">
          <td colSpan={10} className="px-3 py-4 sm:px-5">
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div>
                <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-[var(--ink-soft)]">
                  {copy.detailTitle}
                </p>
                <dl className="mt-2.5 space-y-1">
                  {lines.map(([label, value, strong]) => (
                    <div
                      key={label}
                      className={cn(
                        "flex justify-between gap-6 py-1 text-[13px]",
                        strong && "border-t border-[var(--line)] pt-1.5 font-semibold",
                      )}
                    >
                      <dt className={strong ? "text-[var(--ink)]" : "text-[var(--ink-soft)]"}>
                        {label}
                      </dt>
                      <dd className="tabular-nums text-[var(--ink)]">{value}</dd>
                    </div>
                  ))}
                </dl>
              </div>

              <div className="space-y-3">
                <div>
                  <label
                    className="mb-1.5 block text-[12px] font-semibold uppercase tracking-[0.12em] text-[var(--ink-soft)]"
                    htmlFor={`price-${row.make}-${row.model}-${row.year}`}
                  >
                    {copy.detailPriceLabel}
                  </label>
                  <div className="flex gap-2">
                    <input
                      id={`price-${row.make}-${row.model}-${row.year}`}
                      type="number"
                      min={0}
                      step={500}
                      value={override ?? Math.round(row.price)}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        onOverride(Number.isFinite(value) && value > 0 ? value : null);
                      }}
                      className="h-10 w-40 rounded-[var(--control-radius)] border border-[var(--line-strong)] bg-[var(--surface)] px-3 text-sm tabular-nums text-[var(--ink)] outline-none focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand-soft)]"
                    />
                    {row.priceIsOverride ? (
                      <button
                        type="button"
                        onClick={() => onOverride(null)}
                        className="text-[12px] font-medium text-[var(--brand)]"
                      >
                        {copy.detailPriceReset}
                      </button>
                    ) : null}
                  </div>
                  <p className="mt-1.5 max-w-md text-[12px] leading-5 text-[var(--ink-soft)]">
                    {copy.detailPriceHint}
                  </p>
                </div>

                <dl className="space-y-1 text-[13px]">
                  <div className="flex justify-between gap-6">
                    <dt className="text-[var(--ink-soft)]">{copy.detailKm}</dt>
                    <dd className="tabular-nums text-[var(--ink)]">
                      {Math.round(row.annualKm).toLocaleString(getLocaleTag(locale))} km
                    </dd>
                  </div>
                  <div className="flex justify-between gap-6">
                    <dt className="text-[var(--ink-soft)]">{copy.detailPayback}</dt>
                    <dd className="tabular-nums text-[var(--ink)]">
                      {Number.isFinite(row.paybackYears)
                        ? fill(copy.detailPaybackYears, { years: row.paybackYears.toFixed(1) })
                        : copy.detailPaybackNever}
                    </dd>
                  </div>
                </dl>

                <p className="text-[12px] leading-5 text-[var(--ink-soft)]">
                  {row.evidence.kind === "direct"
                    ? fill(copy.detailEvidenceDirect, { months: row.evidence.vehicleMonths })
                    : copy.detailEvidenceSegment}
                </p>
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}
