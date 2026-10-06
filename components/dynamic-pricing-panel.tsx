"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { getMessages, type Locale } from "@/lib/i18n";
import { formatCurrency } from "@/lib/utils";
import type { PriceFactors, PricingEvent } from "@/lib/vehicle-pricing-dynamic";

type Settings = {
  enabled: boolean;
  autoApply: boolean;
  horizonDays: number;
  minPct: number;
  maxPct: number;
  maxDailyChangePct: number;
  weekendPct: number;
  holidayPct: number;
  lastMinuteDays: number;
  lastMinutePct: number;
  farOutDays: number;
  farOutPct: number;
  targetOccupancy: number;
  occupancyStrength: number;
  gapMaxDays: number;
  gapPct: number;
  events: PricingEvent[];
  excludedVehicleIds: string[];
};

type Suggestion = { vehicleId: string; day: string; current: number; suggested: number; factors: PriceFactors };

/** Fields shown as percentages; the rest are plain numbers. */
const PERCENT = new Set([
  "minPct",
  "maxPct",
  "maxDailyChangePct",
  "weekendPct",
  "holidayPct",
  "lastMinutePct",
  "farOutPct",
  "targetOccupancy",
  "gapPct",
]);
const LIMIT_FIELDS = ["horizonDays", "minPct", "maxPct", "maxDailyChangePct"] as const;
const FACTOR_FIELDS = [
  "weekendPct",
  "holidayPct",
  "lastMinuteDays",
  "lastMinutePct",
  "farOutDays",
  "farOutPct",
  "targetOccupancy",
  "occupancyStrength",
  "gapMaxDays",
  "gapPct",
] as const;
type NumberField = (typeof LIMIT_FIELDS)[number] | (typeof FACTOR_FIELDS)[number];

export function DynamicPricingPanel({
  locale,
  settings,
  lastRun,
  vehicles,
  suggestions,
}: {
  locale: Locale;
  settings: Settings;
  lastRun: string | null;
  vehicles: Array<{ id: string; label: string }>;
  suggestions: Suggestion[];
}) {
  const copy = getMessages(locale).directBookingPricing;
  const money = (value: number) => formatCurrency(value, locale);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const [enabled, setEnabled] = useState(settings.enabled);
  const [autoApply, setAutoApply] = useState(settings.autoApply);
  const [values, setValues] = useState<Record<NumberField, string>>(() => {
    const entries = [...LIMIT_FIELDS, ...FACTOR_FIELDS].map((field) => {
      const raw = settings[field];
      return [field, PERCENT.has(field) ? String(Math.round(raw * 1000) / 10) : String(raw)];
    });
    return Object.fromEntries(entries) as Record<NumberField, string>;
  });
  const [events, setEvents] = useState(settings.events.map((event) => ({ ...event, pct: String(Math.round(event.pct * 100)) })));
  const [excluded, setExcluded] = useState(new Set(settings.excludedVehicleIds));

  const byVehicle = useMemo(() => {
    const groups = new Map<string, Suggestion[]>();
    for (const suggestion of suggestions) {
      groups.set(suggestion.vehicleId, [...(groups.get(suggestion.vehicleId) ?? []), suggestion]);
    }
    return groups;
  }, [suggestions]);

  async function send(method: "PATCH" | "POST", body: unknown) {
    const response = await fetch("/api/direct-booking/dynamic-pricing", {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    const data = (await response?.json().catch(() => null)) as Record<string, unknown> | null;
    return response?.ok ? data ?? {} : null;
  }

  function run(label: string, task: () => Promise<string | null>) {
    setBusy(label);
    setNotice(null);
    startTransition(async () => {
      const text = await task();
      setBusy(null);
      setNotice(text === null ? { ok: false, text: copy.error } : text ? { ok: true, text } : null);
      router.refresh();
    });
  }

  function save() {
    const numbers = Object.fromEntries(
      Object.entries(values).map(([field, raw]) => [field, PERCENT.has(field) ? Number(raw) / 100 : Number(raw)]),
    );
    run("save", async () => {
      const result = await send("PATCH", {
        enabled,
        autoApply,
        ...numbers,
        events: events
          .filter((event) => event.from && event.to)
          .map((event) => ({ ...event, pct: Number(event.pct) / 100 })),
        excludedVehicleIds: [...excluded],
      });
      if (!result) return null;
      return Number(result.cleared) > 0 ? copy.clearedNotice(Number(result.cleared)) : copy.saved;
    });
  }

  const field = "h-8 w-full rounded-md border border-[color:var(--line)] bg-white px-2 text-[12px] tabular-nums";
  const button = "rounded-md border border-[color:var(--line)] bg-white px-3 py-1.5 text-[12px] font-medium text-[color:var(--ink)] disabled:opacity-50";
  const primary = "rounded-md bg-[var(--ink)] px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50";

  const numberInput = (name: NumberField) => {
    const [label, hint] = copy.fields[name];
    return (
      <label key={name} className="block min-w-0">
        <span className="mb-1 block text-[11px] font-medium text-[color:var(--ink)]">{label}</span>
        <input
          type="number"
          step={PERCENT.has(name) ? "1" : name === "occupancyStrength" ? "0.1" : "1"}
          inputMode="decimal"
          value={values[name]}
          onChange={(event) => setValues((prev) => ({ ...prev, [name]: event.target.value }))}
          className={field}
        />
        {hint ? <span className="mt-1 block text-[11px] leading-4 text-[color:var(--ink-soft)]">{hint}</span> : null}
      </label>
    );
  };

  const factorText = (factors: PriceFactors) =>
    [
      ...(["season", "weekday", "leadTime", "occupancy", "gap", "holiday"] as const)
        .filter((name) => Math.abs(factors[name] - 1) >= 0.005)
        .map((name) => `${name === "holiday" && factors.event ? factors.event : copy.factorNames[name]} ×${factors[name].toFixed(2)}`),
      ...factors.clampedBy.map((clamp) => copy.clampNames[clamp]),
    ].join(" · ");

  return (
    <div className="space-y-3">
      <section className="rounded-lg border border-[color:var(--line)] bg-[rgba(255,255,255,0.88)] px-3 py-3 sm:px-4">
        <h3 className="text-[1.05rem] font-semibold text-[color:var(--ink)]">{copy.title}</h3>
        <p className="mt-1 max-w-3xl text-[12px] leading-5 text-[color:var(--ink-soft)]">{copy.intro}</p>

        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {[
            { checked: enabled, set: setEnabled, label: copy.enabledLabel, hint: copy.enabledHint, disabled: false },
            { checked: autoApply && enabled, set: setAutoApply, label: copy.autoApplyLabel, hint: copy.autoApplyHint, disabled: !enabled },
          ].map((toggle) => (
            <label key={toggle.label} className={`flex gap-2 rounded-md border border-[color:var(--line)] bg-white p-2 ${toggle.disabled ? "opacity-50" : ""}`}>
              <input type="checkbox" checked={toggle.checked} disabled={toggle.disabled} onChange={(event) => toggle.set(event.target.checked)} className="mt-0.5 shrink-0" />
              <span>
                <span className="block text-[12px] font-semibold text-[color:var(--ink)]">{toggle.label}</span>
                <span className="block text-[11px] leading-4 text-[color:var(--ink-soft)]">{toggle.hint}</span>
              </span>
            </label>
          ))}
        </div>

        <details className="mt-3" open={!settings.enabled}>
          <summary className="cursor-pointer text-[12px] font-semibold text-[color:var(--ink)]">
            {copy.sections.limits} · {copy.sections.factors} · {copy.sections.events} · {copy.sections.cars}
          </summary>
          <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-[color:var(--ink-soft)]">{copy.sections.limits}</p>
          <div className="mt-1 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{LIMIT_FIELDS.map(numberInput)}</div>
          <p className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-[color:var(--ink-soft)]">{copy.sections.factors}</p>
          <div className="mt-1 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{FACTOR_FIELDS.map(numberInput)}</div>

          <p className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-[color:var(--ink-soft)]">{copy.sections.events}</p>
          <p className="text-[11px] text-[color:var(--ink-soft)]">{copy.eventsHint}</p>
          <div className="mt-1 space-y-1.5">
            {events.map((event, index) => (
              <div key={index} className="grid grid-cols-2 gap-1.5 sm:grid-cols-[9rem_9rem_5rem_1fr_auto]">
                <input type="date" aria-label={copy.eventFrom} value={event.from} onChange={(e) => setEvents((prev) => prev.map((item, i) => (i === index ? { ...item, from: e.target.value } : item)))} className={field} />
                <input type="date" aria-label={copy.eventTo} value={event.to} onChange={(e) => setEvents((prev) => prev.map((item, i) => (i === index ? { ...item, to: e.target.value } : item)))} className={field} />
                <input type="number" aria-label={copy.eventPct} placeholder="%" value={event.pct} onChange={(e) => setEvents((prev) => prev.map((item, i) => (i === index ? { ...item, pct: e.target.value } : item)))} className={field} />
                <input aria-label={copy.eventLabel} placeholder={copy.eventLabel} maxLength={60} value={event.label} onChange={(e) => setEvents((prev) => prev.map((item, i) => (i === index ? { ...item, label: e.target.value } : item)))} className={field} />
                <button type="button" onClick={() => setEvents((prev) => prev.filter((_, i) => i !== index))} className={button}>
                  {copy.removeEvent}
                </button>
              </div>
            ))}
            <button type="button" onClick={() => setEvents((prev) => [...prev, { from: "", to: "", pct: "20", label: "" }])} className={button}>
              {copy.addEvent}
            </button>
          </div>

          <p className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-[color:var(--ink-soft)]">{copy.sections.cars}</p>
          <div className="mt-1 grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
            {vehicles.map((vehicle) => (
              <label key={vehicle.id} className="flex items-center gap-2 text-[12px] text-[color:var(--ink)]">
                <input
                  type="checkbox"
                  className="shrink-0"
                  checked={!excluded.has(vehicle.id)}
                  onChange={(event) =>
                    setExcluded((prev) => {
                      const next = new Set(prev);
                      if (event.target.checked) next.delete(vehicle.id);
                      else next.add(vehicle.id);
                      return next;
                    })
                  }
                />
                <span className="truncate">{vehicle.label}</span>
              </label>
            ))}
          </div>
        </details>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" disabled={pending} onClick={save} className={primary} style={{ backgroundColor: "var(--ink)", color: "#ffffff" }}>
            {busy === "save" ? copy.saving : copy.save}
          </button>
          <button
            type="button"
            disabled={pending || !settings.enabled}
            onClick={() => run("compute", async () => ((await send("POST", { action: "compute" })) ? "" : null))}
            className={button}
          >
            {busy === "compute" ? copy.computing : copy.compute}
          </button>
          {suggestions.length > 0 ? (
            <button
              type="button"
              disabled={pending || !settings.enabled}
              onClick={() => run("apply", async () => ((await send("POST", { action: "apply" })) ? "" : null))}
              className={primary}
              style={{ backgroundColor: "var(--ink)", color: "#ffffff" }}
            >
              {copy.applyAll(suggestions.length)}
            </button>
          ) : null}
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (window.confirm(copy.clearConfirm)) run("clear", async () => ((await send("POST", { action: "clear" })) ? "" : null));
            }}
            className={button}
          >
            {copy.clear}
          </button>
          {lastRun ? <span className="text-[11px] text-[color:var(--ink-soft)]">{copy.lastRun(lastRun)}</span> : null}
        </div>
        {!settings.enabled ? <p className="mt-2 text-[12px] text-[color:var(--ink-soft)]">{copy.offNotice}</p> : null}
        {notice ? (
          <p className={`mt-2 text-[12px] ${notice.ok ? "text-[color:var(--ok-fg)]" : "text-[color:var(--bad-fg)]"}`}>{notice.text}</p>
        ) : null}
      </section>

      {settings.enabled && lastRun && suggestions.length === 0 ? (
        <p className="rounded-lg border border-[color:var(--line)] bg-[rgba(255,255,255,0.88)] px-4 py-3 text-[12px] text-[color:var(--ink-soft)]">
          {copy.empty}
        </p>
      ) : null}

      {[...byVehicle].map(([vehicleId, rows]) => {
        const vehicle = vehicles.find((each) => each.id === vehicleId);
        const up = rows.filter((row) => row.suggested > row.current).length;
        return (
          <details key={vehicleId} className="rounded-lg border border-[color:var(--line)] bg-[rgba(255,255,255,0.88)] px-3 py-2 sm:px-4">
            <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 py-1">
              <span className="text-[13px] font-semibold text-[color:var(--ink)]">{vehicle?.label ?? vehicleId}</span>
              <span className="text-[12px] text-[color:var(--ink-soft)]">{copy.carSummary(rows.length, up, rows.length - up)}</span>
            </summary>
            {/* Two lines per day on a phone -- the reasons are the point,
                and a table there hid them off the right edge. */}
            <div className="mt-2 text-[12px]">
              <div className="hidden grid-cols-[6.5rem_5rem_8rem_1fr] gap-2 py-1 text-[11px] text-[color:var(--ink-soft)] sm:grid">
                <span>{copy.colDate}</span>
                <span className="text-right">{copy.colNow}</span>
                <span className="text-right">{copy.colSuggested}</span>
                <span>{copy.colWhy}</span>
              </div>
              {rows.map((row) => {
                const change = row.current > 0 ? Math.round(((row.suggested - row.current) / row.current) * 100) : 0;
                return (
                  <div
                    key={row.day}
                    className="grid grid-cols-[1fr_auto] gap-x-2 border-t border-[color:var(--line)] py-1.5 sm:grid-cols-[6.5rem_5rem_8rem_1fr] sm:items-baseline"
                  >
                    <span className="tabular-nums text-[color:var(--ink)]">{row.day}</span>
                    <span className="text-right tabular-nums sm:order-none">
                      <span className="text-[color:var(--ink-soft)] sm:hidden">{money(row.current)} → </span>
                      <span className={`font-semibold sm:hidden ${change > 0 ? "text-[color:var(--ok-fg)]" : "text-[color:var(--bad-fg)]"}`}>
                        {money(row.suggested)} ({change > 0 ? "+" : ""}{change}%)
                      </span>
                      <span className="hidden text-[color:var(--ink-soft)] sm:inline">{money(row.current)}</span>
                    </span>
                    <span className={`hidden text-right font-semibold tabular-nums sm:block ${change > 0 ? "text-[color:var(--ok-fg)]" : "text-[color:var(--bad-fg)]"}`}>
                      {money(row.suggested)} <span className="font-normal">({change > 0 ? "+" : ""}{change}%)</span>
                    </span>
                    <span className="col-span-2 text-[11px] text-[color:var(--ink-mid)] sm:col-span-1">{factorText(row.factors)}</span>
                  </div>
                );
              })}
            </div>
            <button
              type="button"
              disabled={pending}
              onClick={() => run("apply-" + vehicleId, async () => ((await send("POST", { action: "apply", vehicleId })) ? "" : null))}
              className={`${button} mt-2`}
            >
              {copy.applyCar}
            </button>
          </details>
        );
      })}
    </div>
  );
}
