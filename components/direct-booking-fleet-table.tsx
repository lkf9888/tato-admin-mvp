"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";

import { updateVehicleBookingAction, type VehicleBookingPatch } from "@/lib/direct-booking-actions";
import { getMessages, type Locale } from "@/lib/i18n";
import { formatCurrency } from "@/lib/utils";

export type FleetRow = {
  id: string;
  plate: string;
  title: string;
  owner: string | null;
  isArchived: boolean;
  turoCode: string | null;
  enabled: boolean;
  /** The car's own typed price. Null means the model prices it. */
  dailyRate: number | null;
  /** What the model would charge, when the model knows the car. */
  aiRate: number | null;
  insurance: number | null;
  deposit: number | null;
  taxName: string | null;
  taxRate: number | null;
  weekly: number | null;
  minDays: number | null;
  km: number | null;
  extraKm: number | null;
  intro: string | null;
  photoCount: number;
  /** The first photo, which is also the rental site's cover. */
  thumbUrl: string | null;
  busy: string[];
  /** Epoch ms of the next booking that blocks the car, for sorting. */
  nextBusyAt: number | null;
  shareUrl: string;
};

export type FleetDefaults = {
  insurance: number;
  deposit: number;
  taxName: string | null;
  taxRate: number;
  weekly: number;
  minDays: number;
  km: number;
  extraKm: number;
};

type Filter = "all" | "live" | "draft" | "manual" | "ai" | "noPhotos" | "overrides" | "archived";
type Sort = "plate" | "model" | "priceAsc" | "priceDesc" | "nextBusy";
type BulkField = "bookingDepositAmount" | "bookingInsuranceFee" | "bookingTaxRate" | "bookingDailyRate";

const FILTERS: Filter[] = ["all", "live", "draft", "manual", "ai", "noPhotos", "overrides", "archived"];
const SORTS: Sort[] = ["plate", "model", "priceAsc", "priceDesc", "nextBusy"];

function effectiveRate(row: FleetRow) {
  return row.dailyRate ?? row.aiRate;
}

function isLive(row: FleetRow) {
  return row.enabled && (effectiveRate(row) ?? 0) > 0 && !row.isArchived;
}

function hasOverrides(row: FleetRow) {
  return [row.insurance, row.deposit, row.taxName, row.taxRate, row.weekly, row.minDays, row.km, row.extraKm].some(
    (value) => value != null,
  );
}

function parseMoney(raw: string): number | null | "invalid" {
  const clean = raw.trim().replace(/^\$/, "");
  if (!clean) return null;
  const value = Number(clean);
  return Number.isFinite(value) && value >= 0 ? value : "invalid";
}

/** The fleet table's filter state lives in the URL, so a reload or a
 *  back-navigation lands on the same list rather than all 130 cars. */
function readUrlState() {
  if (typeof window === "undefined") return { q: "", filter: "all" as Filter, sort: "plate" as Sort };
  const params = new URLSearchParams(window.location.search);
  const filter = params.get("filter") as Filter | null;
  const sort = params.get("sort") as Sort | null;
  return {
    q: params.get("q") ?? "",
    filter: filter && FILTERS.includes(filter) ? filter : ("all" as Filter),
    sort: sort && SORTS.includes(sort) ? sort : ("plate" as Sort),
  };
}

export function DirectBookingFleetTable({
  locale,
  rows: initialRows,
  fleet,
}: {
  locale: Locale;
  rows: FleetRow[];
  fleet: FleetDefaults;
}) {
  const copy = getMessages(locale).directBookingFleet;
  const money = (value: number) => formatCurrency(value, locale);

  const [rows, setRows] = useState(initialRows);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("plate");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();
  const searchRef = useRef<HTMLInputElement>(null);

  // Server data wins whenever the page re-renders with fresh rows.
  useEffect(() => setRows(initialRows), [initialRows]);

  useEffect(() => {
    const state = readUrlState();
    setQuery(state.q);
    setFilter(state.filter);
    setSort(state.sort);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    for (const [key, value, fallback] of [
      ["q", query.trim(), ""],
      ["filter", filter, "all"],
      ["sort", sort, "plate"],
    ] as const) {
      if (value && value !== fallback) params.set(key, value);
      else params.delete(key);
    }
    const next = `${window.location.pathname}${params.toString() ? `?${params}` : ""}`;
    window.history.replaceState(window.history.state, "", next);
  }, [query, filter, sort]);

  // "/" jumps to search, as it does in most tools with a long list.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (event.key !== "/" || target?.closest("input, textarea, select, [contenteditable]")) return;
      // The table sits in a tab; on another tab "/" is just a key.
      if (!searchRef.current?.offsetParent) return;
      event.preventDefault();
      searchRef.current?.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const counts = useMemo(() => {
    const active = rows.filter((row) => !row.isArchived);
    return {
      all: active.length,
      live: active.filter(isLive).length,
      draft: active.filter((row) => !isLive(row)).length,
      manual: active.filter((row) => row.dailyRate != null).length,
      ai: active.filter((row) => row.dailyRate == null && row.aiRate != null).length,
      noPhotos: active.filter((row) => row.photoCount === 0).length,
      overrides: active.filter(hasOverrides).length,
      archived: rows.length - active.length,
    } satisfies Record<Filter, number>;
  }, [rows]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = rows.filter((row) => {
      if (filter === "archived" ? !row.isArchived : row.isArchived) return false;
      if (filter === "live" && !isLive(row)) return false;
      if (filter === "draft" && isLive(row)) return false;
      if (filter === "manual" && row.dailyRate == null) return false;
      if (filter === "ai" && !(row.dailyRate == null && row.aiRate != null)) return false;
      if (filter === "noPhotos" && row.photoCount > 0) return false;
      if (filter === "overrides" && !hasOverrides(row)) return false;
      if (!needle) return true;
      return [row.plate, row.title, row.turoCode ?? "", row.owner ?? ""].some((field) =>
        field.toLowerCase().includes(needle),
      );
    });
    const price = (row: FleetRow) => effectiveRate(row) ?? -1;
    return [...matches].sort((left, right) => {
      switch (sort) {
        case "model":
          return left.title.localeCompare(right.title) || left.plate.localeCompare(right.plate);
        case "priceAsc":
          return price(left) - price(right);
        case "priceDesc":
          return price(right) - price(left);
        case "nextBusy":
          return (left.nextBusyAt ?? Infinity) - (right.nextBusyAt ?? Infinity);
        default:
          return left.plate.localeCompare(right.plate);
      }
    });
  }, [rows, query, filter, sort]);

  const allVisibleSelected = visible.length > 0 && visible.every((row) => selected.has(row.id));

  /**
   * Apply a patch to some rows: optimistically on screen, then on the
   * server, rolling the screen back if the server refuses. Returns
   * whether it stuck, so a drawer knows whether to close.
   */
  const applyPatch = useCallback(
    (ids: string[], patch: VehicleBookingPatch, localPatch: Partial<FleetRow>) =>
      new Promise<boolean>((resolve) => {
        const before = rows;
        setRows((current) => current.map((row) => (ids.includes(row.id) ? { ...row, ...localPatch } : row)));
        startTransition(async () => {
          const result = await updateVehicleBookingAction(ids, patch).catch(() => ({ ok: false as const }));
          if (!result.ok) {
            setRows(before);
            setToast({ tone: "bad", text: copy.saveFailed });
            resolve(false);
            return;
          }
          setToast({ tone: "ok", text: copy.saved });
          resolve(true);
        });
      }),
    [rows, copy.saveFailed, copy.saved],
  );

  function toggleSelected(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllVisible() {
    setSelected((current) => {
      const next = new Set(current);
      if (allVisibleSelected) visible.forEach((row) => next.delete(row.id));
      else visible.forEach((row) => next.add(row.id));
      return next;
    });
  }

  function runBulk(label: string, patch: VehicleBookingPatch, localPatch: Partial<FleetRow>) {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (!window.confirm(copy.bulkConfirm(label, ids.length))) return;
    void applyPatch(ids, patch, localPatch).then((ok) => ok && setSelected(new Set()));
  }

  const editing = editingId ? rows.find((row) => row.id === editingId) ?? null : null;

  return (
    <section className="rounded-lg border border-[color:var(--line)] bg-[rgba(255,255,255,0.88)] shadow-[0_20px_50px_-40px_rgba(17,19,24,0.4)]">
      {/* Toolbar: search, filters with counts, sort. */}
      <div className="sticky top-0 z-10 space-y-2 rounded-t-lg border-b border-[color:var(--line)] bg-[var(--surface)]/95 px-3 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`${copy.searchPlaceholder}  /`}
            className="h-9 min-w-0 flex-1 rounded-md border border-[color:var(--line)] bg-[var(--surface-muted)] px-3 text-[13px] text-[color:var(--ink)] sm:max-w-sm"
          />
          <label className="flex items-center gap-1.5 text-[12px] text-[color:var(--ink-soft)]">
            {copy.sortLabel}
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as Sort)}
              className="h-9 rounded-md border border-[color:var(--line)] bg-[var(--surface-muted)] px-2 text-[12px] text-[color:var(--ink)]"
            >
              {SORTS.map((value) => (
                <option key={value} value={value}>
                  {copy.sorts[value]}
                </option>
              ))}
            </select>
          </label>
          <span className="ml-auto text-[12px] tabular-nums text-[color:var(--ink-soft)]">
            {copy.countSummary(visible.length, counts.all)}
          </span>
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-0.5">
          {FILTERS.filter((value) => value !== "archived" || counts.archived > 0).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              className={`shrink-0 rounded-full border px-3 py-1 text-[12px] ${
                filter === value
                  ? "border-[var(--ink)] bg-[var(--ink)] text-white"
                  : "border-[color:var(--line)] bg-white text-[color:var(--ink-mid)] hover:border-[color:var(--line-strong)]"
              }`}
            >
              {copy.filters[value]}
              <span className="ml-1 tabular-nums opacity-70">{counts[value]}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Header row (desktop). */}
      <div className="hidden grid-cols-[28px_minmax(0,2.2fr)_64px_minmax(0,1.3fr)_repeat(3,minmax(0,1fr))_56px_minmax(0,1.2fr)_96px] items-center gap-2 border-b border-[color:var(--line)] px-3 py-2 text-[10px] uppercase tracking-[0.12em] text-[color:var(--ink-soft)] lg:grid">
        <input
          type="checkbox"
          aria-label={copy.selectAll}
          checked={allVisibleSelected}
          onChange={toggleAllVisible}
          className="h-4 w-4"
        />
        <span>{copy.columns.vehicle}</span>
        <span>{copy.columns.listed}</span>
        <span>{copy.columns.rate}</span>
        <span>{copy.columns.insurance}</span>
        <span>{copy.columns.deposit}</span>
        <span>{copy.columns.tax}</span>
        <span>{copy.columns.photos}</span>
        <span>{copy.columns.nextBusy}</span>
        <span />
      </div>

      {visible.length === 0 ? (
        <p className="px-3 py-8 text-center text-[13px] text-[color:var(--ink-soft)]">{copy.noMatches}</p>
      ) : (
        <ul>
          {visible.map((row) => (
            <FleetTableRow
              key={row.id}
              row={row}
              fleet={fleet}
              locale={locale}
              selected={selected.has(row.id)}
              onToggleSelected={() => toggleSelected(row.id)}
              onEdit={() => setEditingId(row.id)}
              onPatch={(patch, localPatch) => void applyPatch([row.id], patch, localPatch)}
              money={money}
            />
          ))}
        </ul>
      )}

      {/* Bulk bar, only while something is selected. */}
      {selected.size > 0 ? (
        <BulkBar
          locale={locale}
          count={selected.size}
          disabled={isPending}
          onClear={() => setSelected(new Set())}
          onList={() => runBulk(copy.bulkList, { directBookingEnabled: true }, { enabled: true })}
          onUnlist={() => runBulk(copy.bulkUnlist, { directBookingEnabled: false }, { enabled: false })}
          onAiPrice={() => runBulk(copy.bulkAiPrice, { bookingDailyRate: null }, { dailyRate: null })}
          onFleetFees={() =>
            runBulk(
              copy.bulkFleetFees,
              { bookingInsuranceFee: null, bookingDepositAmount: null, bookingTaxName: null, bookingTaxRate: null },
              { insurance: null, deposit: null, taxName: null, taxRate: null },
            )
          }
          onSet={(field, value) => {
            const local: Partial<FleetRow> =
              field === "bookingDepositAmount"
                ? { deposit: value }
                : field === "bookingInsuranceFee"
                  ? { insurance: value }
                  : field === "bookingTaxRate"
                    ? { taxRate: value }
                    : { dailyRate: value };
            runBulk(`${copy.bulkSetLabel} ${copy.bulkFields[field]} = ${value}`, { [field]: value }, local);
          }}
        />
      ) : null}

      {editing ? (
        <EditDrawer
          key={editing.id}
          locale={locale}
          row={editing}
          fleet={fleet}
          pending={isPending}
          onClose={() => setEditingId(null)}
          onSave={async (patch, localPatch) => {
            if (Object.keys(patch).length === 0) {
              setEditingId(null);
              return;
            }
            const ok = await applyPatch([editing.id], patch, localPatch);
            if (ok) setEditingId(null);
          }}
        />
      ) : null}

      {toast ? (
        <p
          role="status"
          className={`fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-full px-4 py-2 text-[12px] shadow-lg md:bottom-8 ${
            toast.tone === "ok" ? "bg-[var(--ink)] text-white" : "bg-[var(--bad-bg)] text-[color:var(--bad-fg)]"
          }`}
        >
          {toast.text}
        </p>
      ) : null}
    </section>
  );
}

function Thumb({ row, className }: { row: FleetRow; className: string }) {
  return row.thumbUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={row.thumbUrl}
      alt=""
      loading="lazy"
      decoding="async"
      className={`${className} shrink-0 rounded-md border border-[color:var(--line)] bg-[var(--surface-muted)] object-cover`}
    />
  ) : (
    <span
      aria-hidden
      className={`${className} flex shrink-0 items-center justify-center rounded-md border border-dashed border-[color:var(--line-strong)] bg-[var(--surface-muted)] text-[11px] font-semibold text-[color:var(--ink-soft)]`}
    >
      {row.title.charAt(0)}
    </span>
  );
}

function FeeCell({ own, fleet, format }: { own: number | null; fleet: number; format: (v: number) => string }) {
  // The car's own figure is bold and dotted, the inherited one quiet:
  // scanning a column for exceptions is the reason the column exists.
  return own == null ? (
    <span className="truncate text-[12px] text-[color:var(--ink-soft)]">{format(fleet)}</span>
  ) : (
    <span className="flex items-center gap-1 truncate text-[12px] font-semibold text-[color:var(--ink)]">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
      {format(own)}
    </span>
  );
}

function FleetTableRow({
  row,
  fleet,
  locale,
  selected,
  onToggleSelected,
  onEdit,
  onPatch,
  money,
}: {
  row: FleetRow;
  fleet: FleetDefaults;
  locale: Locale;
  selected: boolean;
  onToggleSelected: () => void;
  onEdit: () => void;
  onPatch: (patch: VehicleBookingPatch, localPatch: Partial<FleetRow>) => void;
  money: (value: number) => string;
}) {
  const copy = getMessages(locale).directBookingFleet;
  const [rateDraft, setRateDraft] = useState(row.dailyRate == null ? "" : String(row.dailyRate));
  useEffect(() => setRateDraft(row.dailyRate == null ? "" : String(row.dailyRate)), [row.dailyRate]);
  const live = isLive(row);
  const rate = effectiveRate(row);

  // Reads the field itself rather than the draft state: a blur that
  // lands in the same tick as the last keystroke would otherwise see
  // the value from before it, and save nothing.
  function commitRate(value: string) {
    const parsed = parseMoney(value);
    if (parsed === "invalid") {
      setRateDraft(row.dailyRate == null ? "" : String(row.dailyRate));
      return;
    }
    if (parsed === row.dailyRate) return;
    onPatch({ bookingDailyRate: parsed }, { dailyRate: parsed });
  }

  const status = row.isArchived
    ? copy.archived
    : live
      ? copy.statusLive
      : row.enabled && !rate
        ? copy.statusNoPrice
        : copy.statusDraft;

  return (
    <li
      className={`grid grid-cols-[28px_minmax(0,1fr)_52px_64px] items-center gap-2 border-b border-[color:var(--line)] px-3 py-2 last:border-b-0 lg:grid-cols-[28px_minmax(0,2.2fr)_64px_minmax(0,1.3fr)_repeat(3,minmax(0,1fr))_56px_minmax(0,1.2fr)_96px] ${
        selected ? "bg-[var(--brand-soft)]" : "hover:bg-[var(--surface-muted)]"
      }`}
    >
      <input
        type="checkbox"
        aria-label={row.plate}
        checked={selected}
        onChange={onToggleSelected}
        className="h-4 w-4"
      />

      <button type="button" onClick={onEdit} className="flex min-w-0 items-center gap-2.5 text-left">
        <Thumb row={row} className="h-9 w-12" />
        <span className="min-w-0">
        <span className="flex items-center gap-1.5">
          <span className="text-[13px] font-semibold tabular-nums text-[color:var(--ink)]">{row.plate}</span>
          <span
            className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
              live
                ? "bg-[var(--ok-bg)] text-[color:var(--ok-fg)]"
                : row.enabled && !rate
                  ? "bg-[var(--warn-bg)] text-[color:var(--warn-fg)]"
                  : "bg-[var(--surface-muted)] text-[color:var(--ink-soft)]"
            }`}
          >
            {status}
          </span>
        </span>
        <span className="block truncate text-[12px] text-[color:var(--ink-soft)]">
          {row.title}
          {/* On a phone the price has no column of its own. */}
          <span className="lg:hidden">{rate ? ` · ${money(rate)}` : ""}</span>
        </span>
        </span>
      </button>

      <label className="relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center">
        <input
          type="checkbox"
          className="peer sr-only"
          checked={row.enabled}
          disabled={row.isArchived}
          aria-label={copy.columns.listed}
          onChange={(event) =>
            onPatch({ directBookingEnabled: event.target.checked }, { enabled: event.target.checked })
          }
        />
        <span className="absolute inset-0 rounded-full bg-[var(--line-strong)] transition peer-checked:bg-[var(--ok-fg)] peer-disabled:opacity-40" />
        <span className="absolute left-0.5 h-5 w-5 rounded-full bg-white shadow transition peer-checked:translate-x-5" />
      </label>

      <div className="hidden min-w-0 items-center gap-1.5 lg:flex">
        <input
          value={rateDraft}
          onChange={(event) => setRateDraft(event.target.value)}
          onBlur={(event) => commitRate(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") (event.target as HTMLInputElement).blur();
            if (event.key === "Escape") {
              setRateDraft(row.dailyRate == null ? "" : String(row.dailyRate));
              (event.target as HTMLInputElement).blur();
            }
          }}
          inputMode="decimal"
          placeholder={row.aiRate != null ? String(row.aiRate) : "—"}
          aria-label={copy.columns.rate}
          className="h-8 w-16 rounded-md border border-transparent bg-transparent px-1.5 text-[13px] font-semibold tabular-nums text-[color:var(--ink)] placeholder:font-normal placeholder:text-[color:var(--ink-soft)] hover:border-[color:var(--line)] focus:border-[color:var(--line-strong)] focus:bg-white"
        />
        <span
          className={`shrink-0 rounded px-1 text-[10px] ${
            row.dailyRate != null
              ? "bg-[var(--surface-muted)] text-[color:var(--ink-mid)]"
              : row.aiRate != null
                ? "bg-[var(--brand-soft)] text-[color:var(--brand)]"
                : "bg-[var(--warn-bg)] text-[color:var(--warn-fg)]"
          }`}
        >
          {row.dailyRate != null ? copy.rateManual : row.aiRate != null ? copy.rateAi : copy.rateNone}
        </span>
      </div>

      <div className="hidden min-w-0 lg:block">
        <FeeCell own={row.insurance} fleet={fleet.insurance} format={money} />
      </div>
      <div className="hidden min-w-0 lg:block">
        <FeeCell own={row.deposit} fleet={fleet.deposit} format={money} />
      </div>
      <div className="hidden min-w-0 lg:block">
        <FeeCell own={row.taxRate} fleet={fleet.taxRate} format={(v) => `${Number(v.toFixed(3))}%`} />
      </div>
      <span
        className={`hidden text-[12px] tabular-nums lg:block ${
          row.photoCount === 0 ? "font-semibold text-[color:var(--warn-fg)]" : "text-[color:var(--ink-mid)]"
        }`}
      >
        {row.photoCount}
      </span>
      <span className="hidden truncate text-[12px] tabular-nums text-[color:var(--ink-mid)] lg:block">
        {row.busy[0] ?? <span className="text-[color:var(--ink-soft)]">{copy.noneBusy}</span>}
      </span>

      <div className="flex items-center justify-end gap-1">
        <a
          href={row.shareUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="hidden rounded-md px-2 py-1 text-[12px] text-[color:var(--ink-soft)] hover:bg-[var(--surface-muted)] hover:text-[color:var(--ink)] lg:inline"
        >
          {copy.preview}
        </a>
        <button
          type="button"
          onClick={onEdit}
          className="rounded-md border border-[color:var(--line)] bg-white px-2 py-1 text-[12px] text-[color:var(--ink)] hover:border-[color:var(--line-strong)]"
        >
          {copy.edit}
        </button>
      </div>
    </li>
  );
}

function BulkBar({
  locale,
  count,
  disabled,
  onClear,
  onList,
  onUnlist,
  onAiPrice,
  onFleetFees,
  onSet,
}: {
  locale: Locale;
  count: number;
  disabled: boolean;
  onClear: () => void;
  onList: () => void;
  onUnlist: () => void;
  onAiPrice: () => void;
  onFleetFees: () => void;
  onSet: (field: BulkField, value: number) => void;
}) {
  const copy = getMessages(locale).directBookingFleet;
  const [field, setField] = useState<BulkField>("bookingDepositAmount");
  const [value, setValue] = useState("");
  const parsed = parseMoney(value);
  const button =
    "rounded-md border border-white/20 px-2.5 py-1.5 text-[12px] font-medium text-white hover:bg-white/10 disabled:opacity-50";

  return (
    <div className="fixed inset-x-2 bottom-20 z-40 mx-auto flex max-w-4xl flex-wrap items-center gap-2 rounded-lg bg-[var(--ink)] px-3 py-2.5 shadow-2xl md:bottom-6">
      <span className="text-[12px] font-semibold text-white">{copy.selectedCount(count)}</span>
      <button type="button" className={button} disabled={disabled} onClick={onList}>
        {copy.bulkList}
      </button>
      <button type="button" className={button} disabled={disabled} onClick={onUnlist}>
        {copy.bulkUnlist}
      </button>
      <button type="button" className={button} disabled={disabled} onClick={onAiPrice}>
        {copy.bulkAiPrice}
      </button>
      <button type="button" className={button} disabled={disabled} onClick={onFleetFees}>
        {copy.bulkFleetFees}
      </button>
      <span className="flex items-center gap-1">
        <span className="text-[12px] text-white/70">{copy.bulkSetLabel}</span>
        <select
          value={field}
          onChange={(event) => setField(event.target.value as BulkField)}
          className="h-8 rounded-md border border-white/20 bg-transparent px-1.5 text-[12px] text-white"
        >
          {(Object.keys(copy.bulkFields) as BulkField[]).map((key) => (
            <option key={key} value={key} className="text-black">
              {copy.bulkFields[key]}
            </option>
          ))}
        </select>
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          inputMode="decimal"
          className="h-8 w-20 rounded-md border border-white/20 bg-transparent px-2 text-[12px] tabular-nums text-white placeholder:text-white/40"
          placeholder="0"
        />
        <button
          type="button"
          className={button}
          disabled={disabled || parsed === "invalid" || parsed == null}
          onClick={() => typeof parsed === "number" && onSet(field, parsed)}
        >
          {copy.bulkApply}
        </button>
      </span>
      <button type="button" onClick={onClear} className="ml-auto text-[12px] text-white/70 hover:text-white">
        {copy.clearSelection}
      </button>
    </div>
  );
}

type DrawerFields = {
  enabled: boolean;
  dailyRate: string;
  insurance: string;
  deposit: string;
  taxName: string;
  taxRate: string;
  weekly: string;
  minDays: string;
  km: string;
  extraKm: string;
  intro: string;
};

const show = (value: number | string | null) => (value == null ? "" : String(value));

function EditDrawer({
  locale,
  row,
  fleet,
  pending,
  onClose,
  onSave,
}: {
  locale: Locale;
  row: FleetRow;
  fleet: FleetDefaults;
  pending: boolean;
  onClose: () => void;
  onSave: (patch: VehicleBookingPatch, localPatch: Partial<FleetRow>) => void;
}) {
  const copy = getMessages(locale).directBookingFleet;
  const page = getMessages(locale).directBookingPage;
  const money = (value: number) => formatCurrency(value, locale);
  const [fields, setFields] = useState<DrawerFields>({
    enabled: row.enabled,
    dailyRate: show(row.dailyRate),
    insurance: show(row.insurance),
    deposit: show(row.deposit),
    taxName: show(row.taxName),
    taxRate: show(row.taxRate),
    weekly: show(row.weekly),
    minDays: show(row.minDays),
    km: show(row.km),
    extraKm: show(row.extraKm),
    intro: show(row.intro),
  });
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const set = (key: keyof DrawerFields) => (event: { target: { value: string } }) =>
    setFields((current) => ({ ...current, [key]: event.target.value }));

  /** Only what changed goes to the server, so saving one field cannot
   *  overwrite another that somebody else edited in the meantime. */
  function submit() {
    const patch: VehicleBookingPatch = {};
    const local: Partial<FleetRow> = {};
    const numeric: Array<[keyof DrawerFields, keyof VehicleBookingPatch, keyof FleetRow, boolean]> = [
      ["dailyRate", "bookingDailyRate", "dailyRate", false],
      ["insurance", "bookingInsuranceFee", "insurance", false],
      ["deposit", "bookingDepositAmount", "deposit", false],
      ["taxRate", "bookingTaxRate", "taxRate", false],
      ["weekly", "bookingWeeklyDiscountPercent", "weekly", false],
      ["minDays", "bookingMinimumRentalDays", "minDays", true],
      ["km", "bookingDailyKmAllowance", "km", true],
      ["extraKm", "bookingExtraKmRate", "extraKm", false],
    ];
    for (const [key, patchKey, rowKey, integer] of numeric) {
      const parsed = parseMoney(fields[key] as string);
      if (parsed === "invalid") {
        setError(true);
        return;
      }
      const value = parsed == null ? null : integer ? Math.round(parsed) : parsed;
      if (value !== row[rowKey]) {
        (patch as Record<string, unknown>)[patchKey] = value;
        (local as Record<string, unknown>)[rowKey] = value;
      }
    }
    const taxName = fields.taxName.trim() || null;
    if (taxName !== row.taxName) {
      patch.bookingTaxName = taxName;
      local.taxName = taxName;
    }
    const intro = fields.intro.trim() || null;
    if (intro !== row.intro) {
      patch.bookingIntro = intro;
      local.intro = intro;
    }
    if (fields.enabled !== row.enabled) {
      patch.directBookingEnabled = fields.enabled;
      local.enabled = fields.enabled;
    }
    setError(false);
    onSave(patch, local);
  }

  const input =
    "mt-1 w-full rounded-md border border-[color:var(--line)] bg-[var(--surface-muted)] px-2.5 py-1.5 text-[13px] tabular-nums text-[color:var(--ink)]";
  const label = "block text-[11px] font-medium text-[color:var(--ink)]";

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <aside
        role="dialog"
        aria-label={row.plate}
        onClick={(event) => event.stopPropagation()}
        className="flex h-full w-full max-w-md flex-col bg-[var(--surface)] shadow-2xl"
      >
        <header className="flex items-start justify-between gap-2 border-b border-[color:var(--line)] px-4 py-3">
          <Thumb row={row} className="h-12 w-16" />
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold text-[color:var(--ink)]">
              {row.plate} · {row.title}
            </p>
            <p className="text-[11px] text-[color:var(--ink-soft)]">
              {copy.owner(row.owner ?? page.noOwner)}
              {row.turoCode ? ` · Turo #${row.turoCode}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-[12px] text-[color:var(--ink-soft)] hover:bg-[var(--surface-muted)]"
          >
            {copy.drawerClose}
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
          <label className="flex items-center justify-between gap-3 rounded-md border border-[color:var(--line)] bg-[var(--surface-muted)] px-3 py-2">
            <span className="text-[12px] font-medium text-[color:var(--ink)]">{page.enableLabel}</span>
            <input
              type="checkbox"
              checked={fields.enabled}
              disabled={row.isArchived}
              onChange={(event) => setFields((current) => ({ ...current, enabled: event.target.checked }))}
              className="h-4 w-4"
            />
          </label>

          <div>
            <p className="text-[10px] uppercase tracking-[0.16em] text-[color:var(--ink-soft)]">{copy.drawerPricing}</p>
            <p className="mt-0.5 text-[11px] text-[color:var(--ink-soft)]">{copy.drawerFeesHint}</p>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <label className={`${label} col-span-2`}>
                {page.rateLabel}
                <input
                  value={fields.dailyRate}
                  onChange={set("dailyRate")}
                  inputMode="decimal"
                  placeholder={row.aiRate != null ? String(row.aiRate) : ""}
                  className={input}
                />
                <span className="mt-1 block text-[11px] font-normal text-[color:var(--ink-soft)]">
                  {row.aiRate == null
                    ? page.rateHintNoModel
                    : page.rateHintManual(money(row.aiRate))}
                </span>
              </label>
              <label className={label}>
                {page.insuranceLabel}
                <input
                  value={fields.insurance}
                  onChange={set("insurance")}
                  inputMode="decimal"
                  placeholder={copy.fleetValue(money(fleet.insurance))}
                  className={input}
                />
              </label>
              <label className={label}>
                {page.depositLabel}
                <input
                  value={fields.deposit}
                  onChange={set("deposit")}
                  inputMode="decimal"
                  placeholder={copy.fleetValue(money(fleet.deposit))}
                  className={input}
                />
              </label>
              <label className={label}>
                {page.taxNameLabel}
                <input
                  value={fields.taxName}
                  onChange={set("taxName")}
                  placeholder={fleet.taxName ? copy.fleetValue(fleet.taxName) : ""}
                  className={input}
                />
              </label>
              <label className={label}>
                {page.taxRateLabel}
                <input
                  value={fields.taxRate}
                  onChange={set("taxRate")}
                  inputMode="decimal"
                  placeholder={copy.fleetValue(`${fleet.taxRate}%`)}
                  className={input}
                />
              </label>
            </div>
          </div>

          <div>
            <p className="text-[10px] uppercase tracking-[0.16em] text-[color:var(--ink-soft)]">{copy.drawerRules}</p>
            <p className="mt-0.5 text-[11px] text-[color:var(--ink-soft)]">{copy.drawerRulesHint}</p>
            <div className="mt-2 grid grid-cols-2 gap-3">
              {(
                [
                  ["weekly", page.policyWeeklyLabel, fleet.weekly],
                  ["minDays", page.policyMinDaysLabel, fleet.minDays],
                  ["km", page.policyKmLabel, fleet.km],
                  ["extraKm", page.policyExtraKmLabel, fleet.extraKm],
                ] as const
              ).map(([key, text, fleetValue]) => (
                <label key={key} className={label}>
                  {text}
                  <input
                    value={fields[key]}
                    onChange={set(key)}
                    inputMode="decimal"
                    placeholder={copy.fleetValue(String(fleetValue))}
                    className={input}
                  />
                </label>
              ))}
            </div>
          </div>

          <label className={label}>
            {page.introLabel}
            <textarea
              value={fields.intro}
              onChange={set("intro")}
              rows={3}
              placeholder={page.introPlaceholder}
              className={`${input} font-normal`}
            />
          </label>

          <div className="space-y-2 text-[12px]">
            <p className="text-[10px] uppercase tracking-[0.16em] text-[color:var(--ink-soft)]">{page.blockedDates}</p>
            {row.busy.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {row.busy.map((window) => (
                  <span
                    key={window}
                    className="rounded-md border border-[color:var(--line)] bg-white px-2 py-1 tabular-nums text-[color:var(--ink-mid)]"
                  >
                    {window}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-[color:var(--ink-soft)]">{page.blockedDatesEmpty}</p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-[12px]">
            <Link
              href={`/vehicles?q=${encodeURIComponent(row.plate)}`}
              className="rounded-md border border-[color:var(--line)] px-2.5 py-1.5 text-[color:var(--ink)] hover:bg-[var(--surface-muted)]"
            >
              {copy.managePhotos} · {copy.photoCount(row.photoCount)}
            </Link>
            <a
              href={row.shareUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md border border-[color:var(--line)] px-2.5 py-1.5 text-[color:var(--ink)] hover:bg-[var(--surface-muted)]"
            >
              {copy.preview} ↗
            </a>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(row.shareUrl).then(() => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1500);
                });
              }}
              className="rounded-md border border-[color:var(--line)] px-2.5 py-1.5 text-[color:var(--ink)] hover:bg-[var(--surface-muted)]"
            >
              {copied ? copy.copied : copy.copyLink}
            </button>
          </div>
        </div>

        <footer className="flex items-center gap-3 border-t border-[color:var(--line)] px-4 py-3">
          {error ? <span className="text-[12px] text-[color:var(--bad-fg)]">{copy.saveFailed}</span> : null}
          <button
            type="button"
            onClick={submit}
            disabled={pending}
            className="ml-auto rounded-md px-4 py-2 text-[12px] font-medium text-white disabled:opacity-60"
            style={{ backgroundColor: "var(--ink)", color: "#ffffff" }}
          >
            {pending ? copy.saving : copy.drawerSave}
          </button>
        </footer>
      </aside>
    </div>
  );
}
