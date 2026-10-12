"use client";

import { ArrowDownUp, Plus, Search, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { MobileIconButton, MobileMoreMenu, MobilePageHeader, MobileSheet } from "@/components/mobile-chrome";
import { getMessages, type Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { SEARCH_FIELD_PROPS } from "@/lib/search-field-props";

export const ORDERS_SELECT_MODE_EVENT = "tato:orders-select-mode";

type Filters = {
  q: string;
  status: string;
  source: string;
  vehicleId: string;
  from: string;
  to: string;
  sort: string;
};

function hrefFor(filters: Filters, change: Partial<Filters>) {
  const next = { ...filters, ...change };
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(next)) {
    // "recent" is the default sort; leave it out of the address.
    if (value && !(key === "sort" && value === "recent")) params.set(key, value);
  }
  const query = params.toString();
  return query ? `/orders?${query}` : "/orders";
}

/**
 * The orders page on a phone, above the list: a search field and a
 * filter button, a row of the filters people use most, and one line
 * saying how many orders and what they came to. It replaces four
 * desktop cards that pushed the first order ~700px down.
 *
 * Creating an offline order is ＋ in the top bar; exporting and
 * selecting several orders sit behind ⋯. Everything still works through
 * the same query string as the desktop form, so a filtered list is a
 * link either way.
 */
export function OrdersMobileBar({
  locale,
  filters,
  counts,
  summary,
  vehicles,
  statusOptions,
  sourceOptions,
  exportHref,
  createForm,
}: {
  locale: Locale;
  filters: Filters;
  /** Per chip, when the counts are worth showing (not under a search). */
  counts: { ongoing?: number; booked?: number } | null;
  summary: string;
  vehicles: Array<{ value: string; label: string }>;
  statusOptions: Array<{ value: string; label: string }>;
  sourceOptions: Array<{ value: string; label: string }>;
  exportHref: string;
  createForm: React.ReactNode;
}) {
  const messages = getMessages(locale);
  const t = messages.orders.mobile;
  const f = messages.orders.filters;
  const router = useRouter();
  const [filterOpen, setFilterOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [draft, setDraft] = useState(filters);

  const advancedCount = [filters.vehicleId, filters.from, filters.to].filter(Boolean).length +
    (filters.status && !["ongoing", "booked", "completed"].includes(filters.status) ? 1 : 0);

  const chips: Array<{ key: string; label: string; count?: number; active: boolean; href: string }> = [
    {
      key: "all",
      label: t.chipAll,
      active: !filters.status && !filters.source,
      href: hrefFor(filters, { status: "", source: "" }),
    },
    {
      key: "ongoing",
      label: t.chipOngoing,
      count: counts?.ongoing,
      active: filters.status === "ongoing",
      href: hrefFor(filters, { status: filters.status === "ongoing" ? "" : "ongoing", source: "" }),
    },
    {
      key: "booked",
      label: t.chipBooked,
      count: counts?.booked,
      active: filters.status === "booked",
      href: hrefFor(filters, { status: filters.status === "booked" ? "" : "booked", source: "" }),
    },
    {
      key: "completed",
      label: t.chipCompleted,
      active: filters.status === "completed",
      href: hrefFor(filters, { status: filters.status === "completed" ? "" : "completed", source: "" }),
    },
    {
      key: "offline",
      label: t.chipOffline,
      active: filters.source === "offline",
      href: hrefFor(filters, { source: filters.source === "offline" ? "" : "offline", status: "" }),
    },
  ];

  const selectClass =
    "h-10 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 text-[14px] text-[var(--ink)]";

  return (
    <div className="-mx-2.5 -mt-3 sm:hidden">
      <MobilePageHeader
        actions={
          <>
            <MobileIconButton label={t.create} onClick={() => setCreateOpen(true)}>
              <Plus className="h-5 w-5" strokeWidth={2} aria-hidden />
            </MobileIconButton>
            <MobileMoreMenu
              label={t.more}
              cancelLabel={t.cancel}
              actions={[
                { label: t.select, onClick: () => window.dispatchEvent(new Event(ORDERS_SELECT_MODE_EVENT)) },
                { label: t.exportExcel, href: exportHref, external: true },
              ]}
            />
          </>
        }
      />

      <div className="space-y-2 border-b border-[var(--line)] bg-[var(--surface)] px-3.5 pb-2 pt-2">
        <div className="flex gap-2">
          <form
            method="get"
            action="/orders"
            role="search"
            className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-[10px] bg-[var(--surface-muted)] px-2.5 text-[var(--ink-soft)]"
          >
            <Search className="h-4 w-4 shrink-0" aria-hidden />
            {Object.entries(filters).map(([key, value]) =>
              key !== "q" && value ? <input key={key} type="hidden" name={key} value={value} /> : null,
            )}
            <input
              name="q"
              type="search"
              {...SEARCH_FIELD_PROPS}
              defaultValue={filters.q}
              placeholder={t.searchPlaceholder}
              aria-label={t.search}
              className="tap-compact h-9 min-w-0 flex-1 bg-transparent text-[16px] text-[var(--ink)] outline-none placeholder:text-[13px] placeholder:text-[var(--ink-soft)]"
            />
          </form>
          <button
            type="button"
            onClick={() => {
              setDraft(filters);
              setFilterOpen(true);
            }}
            aria-label={advancedCount ? `${t.filters} (${advancedCount})` : t.filters}
            className="tap-compact hit-area relative flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-[var(--line-strong)] bg-[var(--surface)] text-[var(--ink)]"
          >
            <SlidersHorizontal className="h-[17px] w-[17px]" aria-hidden />
            {advancedCount ? (
              <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--brand)] px-1 text-[10px] font-semibold text-white">
                {advancedCount}
              </span>
            ) : null}
          </button>
        </div>
        <nav aria-label={t.filters} className="-mx-3.5 flex gap-1.5 overflow-x-auto px-3.5 [scrollbar-width:none]">
          {chips.map((chip) => (
            <Link
              key={chip.key}
              href={chip.href}
              aria-current={chip.active ? "true" : undefined}
              className={cn(
                "tap-compact flex h-7 shrink-0 items-center gap-1 rounded-full px-3 text-[12px] font-semibold",
                chip.active ? "bg-[var(--ink)] text-[var(--surface)]" : "bg-[var(--surface-muted)] text-[var(--ink)]",
              )}
            >
              {chip.label}
              {chip.count ? <span className="font-normal opacity-75">{chip.count}</span> : null}
            </Link>
          ))}
        </nav>
      </div>

      <div className="flex items-center justify-between bg-[var(--surface-muted)] px-3.5 pb-1 pt-2 text-[11.5px] text-[var(--ink-soft)]">
        <span className="truncate">{summary}</span>
        <Link
          href={hrefFor(filters, { sort: filters.sort === "pickup" ? "recent" : "pickup" })}
          className="tap-compact flex shrink-0 items-center gap-1 text-[var(--ink-mid)]"
        >
          {filters.sort === "pickup" ? t.sortPickup : t.sortRecent}
          <ArrowDownUp className="h-3 w-3" aria-hidden />
        </Link>
      </div>

      <MobileSheet open={filterOpen} onClose={() => setFilterOpen(false)} label={t.filtersTitle} closeLabel={t.cancel}>
        <form
          className="space-y-3 pb-1"
          onSubmit={(event) => {
            event.preventDefault();
            setFilterOpen(false);
            router.push(hrefFor(draft, {}));
          }}
        >
          <h2 className="text-[17px] font-semibold text-[var(--ink)]">{t.filtersTitle}</h2>
          <label className="block">
            <span className="mb-1 block text-[12px] font-semibold text-[var(--ink-soft)]">{f.statusLabel}</span>
            <select
              value={draft.status}
              onChange={(event) => setDraft({ ...draft, status: event.target.value })}
              className={selectClass}
            >
              <option value="">{f.allStatuses}</option>
              {statusOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] font-semibold text-[var(--ink-soft)]">{f.sourceLabel}</span>
            <select
              value={draft.source}
              onChange={(event) => setDraft({ ...draft, source: event.target.value })}
              className={selectClass}
            >
              {sourceOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] font-semibold text-[var(--ink-soft)]">{f.vehicleLabel}</span>
            <select
              value={draft.vehicleId}
              onChange={(event) => setDraft({ ...draft, vehicleId: event.target.value })}
              className={selectClass}
            >
              <option value="">{f.allVehicles}</option>
              {vehicles.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block min-w-0">
              <span className="mb-1 block text-[12px] font-semibold text-[var(--ink-soft)]">{f.fromLabel}</span>
              <input
                type="date"
                value={draft.from}
                onChange={(event) => setDraft({ ...draft, from: event.target.value })}
                className={selectClass}
              />
            </label>
            <label className="block min-w-0">
              <span className="mb-1 block text-[12px] font-semibold text-[var(--ink-soft)]">{f.toLabel}</span>
              <input
                type="date"
                value={draft.to}
                onChange={(event) => setDraft({ ...draft, to: event.target.value })}
                className={selectClass}
              />
            </label>
          </div>
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => setDraft({ ...filters, status: "", source: "", vehicleId: "", from: "", to: "" })}
              className="tap-compact h-11 flex-1 rounded-[10px] border border-[var(--line-strong)] text-[14px] font-semibold text-[var(--ink)]"
            >
              {t.reset}
            </button>
            <button
              type="submit"
              className="tap-compact h-11 flex-[2] rounded-[10px] bg-[var(--brand)] text-[14px] font-semibold text-white"
            >
              {t.apply}
            </button>
          </div>
        </form>
      </MobileSheet>

      <MobileSheet open={createOpen} onClose={() => setCreateOpen(false)} label={t.create} closeLabel={t.cancel}>
        <h2 className="mb-2 text-[17px] font-semibold text-[var(--ink)]">{t.create}</h2>
        {createForm}
      </MobileSheet>
    </div>
  );
}
