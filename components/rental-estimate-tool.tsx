"use client";

import { useMemo, useState } from "react";

import { getLocaleTag, type Locale, type Messages } from "@/lib/i18n";
import {
  estimateVehicle,
  FIT_SUMMARY,
  eligibleYears,
  listMakes,
  listModels,
  oldestEligibleYear,
  type VehicleEstimate,
} from "@/lib/rental-estimate";
import { cn, formatCurrencyCompact } from "@/lib/utils";

/**
 * Substitute `{token}` placeholders. The message block is deliberately
 * function-free so it can cross the RSC boundary, which means the
 * interpolation has to happen here instead of in the message itself.
 */
function fill(template: string, values: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}

/**
 * "$1.9k" — short enough to sit above a bar on a 375px screen.
 *
 * The prefix is lifted off `formatCurrencyCompact` rather than
 * hard-coded, because Intl renders CAD as "$" under en and "CA$" under
 * zh; writing "$" here put "CA$920" and "$1.2k" side by side in the
 * same row of bars.
 */
function abbreviate(value: number, locale: Locale) {
  if (value < 1000) return formatCurrencyCompact(Math.round(value / 10) * 10, locale);
  const sample = formatCurrencyCompact(1000, locale);
  const prefix = sample.slice(0, sample.search(/\d/));
  const thousands = value / 1000;
  return `${prefix}${thousands.toFixed(thousands < 10 ? 1 : 0)}k`;
}

const CHART_HEIGHT = 208;

export function RentalEstimateTool({
  locale,
  copy,
}: {
  locale: Locale;
  copy: Messages["rentalEstimate"];
}) {
  const now = useMemo(() => new Date(), []);
  const thisYear = now.getFullYear();
  const makes = useMemo(() => listMakes(thisYear), [thisYear]);

  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("");
  const [commission, setCommission] = useState(30);
  const [methodOpen, setMethodOpen] = useState(false);
  const [hovered, setHovered] = useState<number | null>(null);

  const models = useMemo(() => (make ? listModels(make, thisYear) : []), [make, thisYear]);

  // Only years Turo Canada will accept, further clipped to the years the
  // chosen model was actually sold here. Offering a number for a car
  // that cannot be listed is worse than offering none.
  const years = useMemo(
    () => (model ? eligibleYears(make, model, thisYear) : eligibleYears("", "", thisYear)),
    [make, model, thisYear],
  );

  const estimate: VehicleEstimate | null = useMemo(() => {
    if (!make || !model || !year) return null;
    return estimateVehicle({
      make,
      model,
      year: Number(year),
      startYear: now.getFullYear(),
      startMonth: now.getMonth() + 1,
      now: now.getFullYear(),
    });
  }, [make, model, year, now]);

  const ownerShare = 1 - commission / 100;

  // Quoted straight off the fitted model rather than typed into the
  // copy, so re-running scripts/build-rental-estimate-model.ts cannot
  // leave the page claiming an accuracy it no longer has.
  const accuracy = {
    error: `${(FIT_SUMMARY.looAnnualMedianError * 100).toFixed(1)}%`,
    within: `${Math.round(FIT_SUMMARY.looAnnualWithin20 * 100)}%`,
  };

  // Intl already renders the Chinese month as "9月" under `numeric`, so
  // there is nothing to append — doing so produced "9月月".
  const monthLabel = useMemo(() => {
    const isChinese = locale === "zh" || locale === "zh-Hant";
    const formatter = new Intl.DateTimeFormat(getLocaleTag(locale), {
      month: isChinese ? "numeric" : "short",
    });
    return (m: number, y: number) => formatter.format(new Date(y, m - 1, 1));
  }, [locale]);

  const maxGross = estimate ? Math.max(...estimate.months.map((m) => m.gross)) : 1;

  const selectClass =
    "h-11 w-full rounded-[var(--control-radius)] border border-[var(--line-strong)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] outline-none transition focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand-soft)] disabled:cursor-not-allowed disabled:bg-[var(--surface-muted)] disabled:text-[var(--ink-soft)]";
  const labelClass =
    "mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-soft)]";

  return (
    <div className="space-y-5">
      {/* ---------- picker ---------- */}
      <div className="rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface)] p-4 shadow-[0_1px_2px_rgba(17,19,24,0.04)] sm:p-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className={labelClass} htmlFor="re-make">
              {copy.makeLabel}
            </label>
            <select
              id="re-make"
              className={selectClass}
              value={make}
              onChange={(event) => {
                setMake(event.target.value);
                setModel("");
              }}
            >
              <option value="">{copy.makePlaceholder}</option>
              {makes.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelClass} htmlFor="re-model">
              {copy.modelLabel}
            </label>
            <select
              id="re-model"
              className={selectClass}
              value={model}
              disabled={!make}
              onChange={(event) => {
                setModel(event.target.value);
                const next = eligibleYears(make, event.target.value, thisYear);
                if (year && !next.includes(Number(year))) setYear("");
              }}
            >
              <option value="">{make ? copy.modelPlaceholder : copy.modelNeedsMake}</option>
              {models.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelClass} htmlFor="re-year">
              {copy.yearLabel}
            </label>
            <select
              id="re-year"
              className={selectClass}
              value={year}
              onChange={(event) => setYear(event.target.value)}
            >
              <option value="">{copy.yearLabel}</option>
              {years.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-[11px] leading-4 text-[var(--ink-soft)]">
              {/* States the platform rule, so it must not move with the
                  model's own production span. */}
              {fill(copy.yearHint, { oldest: oldestEligibleYear(thisYear) })}
            </p>
          </div>
        </div>
      </div>

      {!estimate ? (
        <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--line-strong)] bg-[var(--surface-muted)] px-6 py-14 text-center">
          <p className="text-base font-semibold text-[var(--ink)]">{copy.emptyTitle}</p>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[var(--ink-soft)]">
            {copy.emptyCopy}
          </p>
        </div>
      ) : (
        <>
          {/* ---------- headline ---------- */}
          <div className="rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface)] p-5 shadow-[0_1px_2px_rgba(17,19,24,0.04)] sm:p-6">
            <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-soft)]">
                  {copy.headlineLabel}
                </p>
                <p className="mt-1.5 text-[2.5rem] font-semibold leading-none tracking-tight text-[var(--ink)] tabular-nums sm:text-[3rem]">
                  {formatCurrencyCompact(estimate.annualGross, locale)}
                </p>
                <p className="mt-2 text-[13px] text-[var(--ink-soft)] tabular-nums">
                  {fill(copy.headlineRange, {
                    low: formatCurrencyCompact(estimate.annualLow, locale),
                    high: formatCurrencyCompact(estimate.annualHigh, locale),
                  })}
                </p>
              </div>

              <div className="rounded-[var(--radius-card)] bg-[var(--brand-soft)] px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--brand)]">
                  {copy.netLabel}
                </p>
                <p className="mt-1 text-[1.75rem] font-semibold leading-none tracking-tight text-[var(--brand)] tabular-nums">
                  {formatCurrencyCompact(estimate.annualGross * ownerShare, locale)}
                </p>
              </div>
            </div>

            {/* commission slider */}
            <div className="mt-6 border-t border-[var(--line)] pt-5">
              <div className="flex items-center justify-between gap-4">
                <label
                  htmlFor="re-commission"
                  className="text-[13px] font-medium text-[var(--ink-mid)]"
                >
                  {copy.commissionLabel}
                </label>
                <span className="text-[15px] font-semibold text-[var(--ink)] tabular-nums">
                  {commission}%
                </span>
              </div>
              <input
                id="re-commission"
                type="range"
                min={0}
                max={50}
                step={1}
                value={commission}
                onChange={(event) => setCommission(Number(event.target.value))}
                className="mt-3 h-2 w-full cursor-pointer appearance-none rounded-full bg-[var(--accent-soft-strong)] accent-[var(--brand)]"
              />
              <p className="mt-2.5 text-xs leading-5 text-[var(--ink-soft)]">
                {copy.commissionHint}
              </p>
            </div>
          </div>

          {/* ---------- chart ---------- */}
          <div className="rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface)] p-4 shadow-[0_1px_2px_rgba(17,19,24,0.04)] sm:p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
              <h2 className="text-[15px] font-semibold text-[var(--ink)]">{copy.chartTitle}</h2>
              <div className="flex items-center gap-4 text-[11px] text-[var(--ink-soft)]">
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-[2px] bg-[var(--brand)]" />
                  {copy.netLabel}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-[2px] bg-[var(--brand-soft)] ring-1 ring-inset ring-[var(--line-strong)]" />
                  {copy.grossLabel}
                </span>
              </div>
            </div>

            <div
              className="mt-6 flex items-end gap-[3px] sm:gap-2"
              style={{ height: CHART_HEIGHT }}
              onMouseLeave={() => setHovered(null)}
            >
              {estimate.months.map((month, index) => {
                const total = (month.gross / maxGross) * (CHART_HEIGHT - 26);
                const net = total * ownerShare;
                const active = hovered === index;
                return (
                  <div
                    key={`${month.year}-${month.month}`}
                    className="group relative flex h-full flex-1 flex-col justify-end"
                    onMouseEnter={() => setHovered(index)}
                    onFocus={() => setHovered(index)}
                    onBlur={() => setHovered(null)}
                    // Touch has no hover, and on mobile the tooltip is the
                    // only way to read a single month's figure.
                    onClick={() => setHovered((current) => (current === index ? null : index))}
                    tabIndex={0}
                    role="img"
                    aria-label={`${monthLabel(month.month, month.year)}: ${formatCurrencyCompact(
                      month.gross,
                      locale,
                    )} ${copy.grossLabel}`}
                  >
                    {/* tooltip */}
                    {active ? (
                      <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 w-max -translate-x-1/2 rounded-[var(--radius-card)] border border-[var(--line-strong)] bg-[var(--panel-strong)] px-2.5 py-2 text-left shadow-[0_8px_24px_rgba(17,19,24,0.12)]">
                        <p className="text-[11px] font-semibold text-[var(--ink)] tabular-nums">
                          {formatCurrencyCompact(month.gross, locale)}
                        </p>
                        <p className="mt-0.5 text-[11px] text-[var(--brand)] tabular-nums">
                          {formatCurrencyCompact(month.gross * ownerShare, locale)}
                        </p>
                      </div>
                    ) : null}

                    {/* Twelve bars across a 375px screen leaves ~26px a
                        column, which "CA$1.9k" overflows. Below `sm` the
                        per-bar figure gives way to tap-for-tooltip and
                        the stat cards underneath; the reserved space
                        stays, because the tooltip needs it. */}
                    <p
                      className={cn(
                        "mb-1 hidden text-center text-[10px] leading-none tabular-nums transition-colors sm:block",
                        active ? "text-[var(--ink)]" : "text-[var(--ink-soft)]",
                      )}
                    >
                      {abbreviate(month.gross, locale)}
                    </p>

                    {/* The bar is its own containing block so the filled
                        portion measures from the bar's baseline, not the
                        column's. */}
                    <div
                      className={cn(
                        "relative w-full rounded-t-[3px] bg-[var(--brand-soft)] ring-1 ring-inset transition-colors",
                        active ? "ring-[var(--brand)]" : "ring-[var(--line-strong)]",
                      )}
                      style={{ height: Math.max(total, 3) }}
                    >
                      <div
                        className="absolute inset-x-0 bottom-0 rounded-t-[3px] bg-[var(--brand)]"
                        style={{ height: Math.max(net, commission >= 100 ? 0 : 2) }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-2 flex gap-[3px] border-t border-[var(--line)] pt-2 sm:gap-2">
              {estimate.months.map((month) => (
                <p
                  key={`label-${month.year}-${month.month}`}
                  // nowrap because a 23px column broke "10月" across two
                  // lines, leaving the label row ragged.
                  className="flex-1 whitespace-nowrap text-center text-[9px] leading-tight text-[var(--ink-soft)] sm:text-[11px]"
                >
                  {monthLabel(month.month, month.year)}
                </p>
              ))}
            </div>

            <p className="mt-4 text-xs leading-5 text-[var(--ink-soft)]">{copy.chartHint}</p>
          </div>

          {/* ---------- stats ---------- */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label={copy.statPeak}
              value={formatCurrencyCompact(estimate.peak.gross, locale)}
              foot={`${monthLabel(estimate.peak.month, estimate.peak.year)} · ${fill(
                copy.statPeakRatio,
                { ratio: (estimate.peak.gross / estimate.trough.gross).toFixed(1) },
              )}`}
              accent
            />
            <Stat
              label={copy.statTrough}
              value={formatCurrencyCompact(estimate.trough.gross, locale)}
              foot={monthLabel(estimate.trough.month, estimate.trough.year)}
            />
            <Stat
              label={copy.statAverage}
              value={formatCurrencyCompact(estimate.averageMonthlyGross, locale)}
              foot={`${formatCurrencyCompact(
                estimate.averageMonthlyGross * ownerShare,
                locale,
              )} · ${copy.netLabel}`}
            />
            <Stat
              label={copy.statValue}
              value={formatCurrencyCompact(estimate.value, locale)}
              foot={`${estimate.year} ${estimate.make} ${estimate.model}`}
            />
          </div>

          {/* ---------- evidence ---------- */}
          <div className="rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface-muted)] p-4 sm:p-5">
            <p className="text-[13px] font-semibold text-[var(--ink)]">
              {estimate.evidence.kind === "direct"
                ? copy.evidenceDirectTitle
                : copy.evidenceSegmentTitle}
            </p>
            <p className="mt-1.5 text-[13px] leading-6 text-[var(--ink-soft)]">
              {estimate.evidence.kind === "direct"
                ? fill(copy.evidenceDirect, {
                    months: estimate.evidence.vehicleMonths,
                    model: `${estimate.make} ${estimate.model}`,
                  })
                : fill(copy.evidenceSegment, {
                    model: `${estimate.make} ${estimate.model}`,
                    within: accuracy.within,
                  })}
            </p>
            {estimate.evidence.extrapolated ? (
              <p className="mt-2 text-[13px] leading-6 text-[var(--warn-fg)]">
                {copy.evidenceExtrapolated}
              </p>
            ) : null}
          </div>
        </>
      )}

      {/* ---------- method ---------- */}
      <div className="rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface)]">
        <button
          type="button"
          onClick={() => setMethodOpen((open) => !open)}
          aria-expanded={methodOpen}
          className="flex min-h-[var(--tap-min)] w-full items-center justify-between gap-4 px-4 py-3.5 text-left sm:px-6"
        >
          <span className="text-[15px] font-semibold text-[var(--ink)]">{copy.methodTitle}</span>
          <span className="shrink-0 text-[13px] font-medium text-[var(--brand)]">
            {methodOpen ? copy.methodToggleClose : copy.methodToggleOpen}
          </span>
        </button>

        {methodOpen ? (
          <div className="space-y-5 border-t border-[var(--line)] px-4 py-5 sm:px-6">
            <p className="text-[13px] leading-6 text-[var(--ink-mid)]">
              {fill(copy.methodBasis, {
                trips: FIT_SUMMARY.trips.toLocaleString(getLocaleTag(locale)),
                vehicles: FIT_SUMMARY.vehicles,
                models: FIT_SUMMARY.models,
                from: FIT_SUMMARY.from,
                to: FIT_SUMMARY.to,
              })}
            </p>

            <dl className="space-y-4">
              {(
                [
                  [copy.methodPoint1Title, copy.methodPoint1],
                  [copy.methodPoint2Title, copy.methodPoint2],
                  [copy.methodPoint3Title, copy.methodPoint3],
                  [copy.methodPoint4Title, fill(copy.methodPoint4, accuracy)],
                ] as const
              ).map(([title, body]) => (
                <div key={title}>
                  <dt className="text-[13px] font-semibold text-[var(--ink)]">{title}</dt>
                  <dd className="mt-1 text-[13px] leading-6 text-[var(--ink-soft)]">{body}</dd>
                </div>
              ))}
            </dl>

            <div className="border-t border-[var(--line)] pt-4">
              <p className="text-[13px] font-semibold text-[var(--ink)]">
                {copy.assumptionsTitle}
              </p>
              <ul className="mt-2 space-y-1.5">
                {[copy.assumption1, copy.assumption2, copy.assumption3, copy.assumption4].map(
                  (item) => (
                    <li
                      key={item}
                      className="flex gap-2 text-[13px] leading-6 text-[var(--ink-soft)]"
                    >
                      <span aria-hidden className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-[var(--line-strong)]" />
                      {item}
                    </li>
                  ),
                )}
              </ul>
            </div>
          </div>
        ) : null}
      </div>

    </div>
  );
}

function Stat({
  label,
  value,
  foot,
  accent,
}: {
  label: string;
  value: string;
  foot: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--line)] bg-[var(--surface)] p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-soft)]">
        {label}
      </p>
      <p
        className={cn(
          "mt-1.5 text-[1.5rem] font-semibold leading-none tracking-tight tabular-nums",
          accent ? "text-[var(--brand)]" : "text-[var(--ink)]",
        )}
      >
        {value}
      </p>
      <p className="mt-1.5 text-xs leading-5 text-[var(--ink-soft)]">{foot}</p>
    </div>
  );
}
