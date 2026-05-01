import Link from "next/link";

import type { Prisma } from "@prisma/client";

import { deleteOrderAction, saveOfflineOrderAction, updateOrderStatusAction } from "@/app/actions";
import { requireCurrentWorkspace } from "@/lib/auth";
import { StatusBadge } from "@/components/status-badge";
import { getOrderStatusOptions, getStatusLabel, type Locale } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n-server";
import { prisma } from "@/lib/prisma";
import {
  cn,
  formatCurrency,
  formatDateTime,
  getDisplayOrderNote,
  getOrderNetEarning,
  normalizeText,
} from "@/lib/utils";

// Bounded pagination: 20 cards per page is comfortable on mobile
// (one column = ~20 fingers of scrolling) and on desktop's 2-up grid
// (~10 rows). Big enough to not feel like clicking through trivia,
// small enough that initial render stays snappy.
const PAGE_SIZE = 20;

// Order sources are the same two enum values used elsewhere in the
// app; declared here so the filter <select> stays a typed source of
// truth instead of a magic-string list.
const ORDER_SOURCES = ["turo", "offline"] as const;
type OrderSource = (typeof ORDER_SOURCES)[number];

type OrdersSearchParams = {
  error?: string;
  q?: string;
  page?: string;
  status?: string;
  source?: string;
  vehicleId?: string;
  from?: string;
  to?: string;
};

/**
 * Build the Prisma `where` clause for the structured filters.
 * The free-text `q` search is applied AFTER this query (in JS) so
 * users can match across many fields and Chinese names without
 * needing case-insensitive SQL (which SQLite doesn't ship).
 */
function buildWhereClause(
  workspaceId: string,
  filters: {
    status?: string;
    source?: string;
    vehicleId?: string;
    from?: Date | null;
    to?: Date | null;
  },
): Prisma.OrderWhereInput {
  const where: Prisma.OrderWhereInput = {
    workspaceId,
    isArchived: false,
  };
  if (filters.status) where.status = filters.status as Prisma.OrderWhereInput["status"];
  if (filters.source && (ORDER_SOURCES as readonly string[]).includes(filters.source)) {
    where.source = filters.source as OrderSource;
  }
  if (filters.vehicleId) where.vehicleId = filters.vehicleId;
  if (filters.from || filters.to) {
    // Date range matches on `pickupDatetime` (the most common "when
    // was the rental?" semantic). `from` includes the whole start day,
    // `to` includes the whole end day, so `from=2026-04-01&to=2026-04-30`
    // returns every trip starting in April.
    where.pickupDatetime = {};
    if (filters.from) (where.pickupDatetime as { gte?: Date }).gte = filters.from;
    if (filters.to) (where.pickupDatetime as { lte?: Date }).lte = filters.to;
  }
  return where;
}

async function fetchFilteredOrders(where: Prisma.OrderWhereInput) {
  return prisma.order.findMany({
    where,
    include: { vehicle: { include: { owner: true } } },
    orderBy: { pickupDatetime: "desc" },
  });
}

type SearchableOrder = Awaited<ReturnType<typeof fetchFilteredOrders>>[number];

function buildOrderSearchText(order: SearchableOrder, locale: Locale) {
  const netEarning = getOrderNetEarning(order.sourceMetadata, order.totalPrice);

  return normalizeText(
    [
      order.id,
      order.externalOrderId,
      order.source,
      order.status,
      order.renterName,
      order.renterPhone,
      order.vehicle.plateNumber,
      order.vehicle.nickname,
      order.vehicle.brand,
      order.vehicle.model,
      String(order.vehicle.year),
      order.vehicle.owner?.name,
      order.pickupLocation,
      order.returnLocation,
      order.paymentMethod,
      order.contractNumber,
      order.createdBy,
      getDisplayOrderNote(order.notes, order.source),
      formatDateTime(order.pickupDatetime, locale),
      formatDateTime(order.returnDatetime, locale),
      order.pickupDatetime.toISOString(),
      order.returnDatetime.toISOString(),
      netEarning != null ? String(netEarning) : null,
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function matchesOrderSearch(order: SearchableOrder, query: string, locale: Locale) {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return true;

  const haystack = buildOrderSearchText(order, locale);
  return normalizedQuery.split(" ").every((term) => haystack.includes(term));
}

/**
 * Parse a `yyyy-mm-dd` (HTML <input type="date"> output) into a Date,
 * or return `null` if missing/invalid. The Date is constructed with
 * the local server time as midnight; for `to` we shift to end-of-day
 * so the inclusive range matches user intent (`to=2026-04-30` includes
 * trips starting on April 30 at any hour).
 */
function parseDateParam(raw: string | undefined, mode: "start" | "end"): Date | null {
  if (!raw) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) return null;
  const [, year, month, day] = match;
  const d = new Date(Number(year), Number(month) - 1, Number(day));
  if (Number.isNaN(d.getTime())) return null;
  if (mode === "end") d.setHours(23, 59, 59, 999);
  return d;
}

/**
 * Build a query string carrying every filter EXCEPT `page`. Used by the
 * pagination links so they preserve the current filter set when the
 * user navigates between pages.
 */
function buildFilterQueryString(filters: {
  q?: string;
  status?: string;
  source?: string;
  vehicleId?: string;
  from?: string;
  to?: string;
}) {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.status) params.set("status", filters.status);
  if (filters.source) params.set("source", filters.source);
  if (filters.vehicleId) params.set("vehicleId", filters.vehicleId);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  return params.toString();
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<OrdersSearchParams>;
}) {
  const workspace = await requireCurrentWorkspace();
  const params = await searchParams;

  const searchQuery = params.q?.trim() ?? "";
  const statusFilter = params.status?.trim() ?? "";
  const sourceFilter = params.source?.trim() ?? "";
  const vehicleFilter = params.vehicleId?.trim() ?? "";
  const fromFilterRaw = params.from?.trim() ?? "";
  const toFilterRaw = params.to?.trim() ?? "";
  const fromDate = parseDateParam(fromFilterRaw, "start");
  const toDate = parseDateParam(toFilterRaw, "end");
  const requestedPage = Number.parseInt(params.page ?? "1", 10);
  const requestedPageSafe = Number.isFinite(requestedPage) && requestedPage >= 1 ? requestedPage : 1;

  const where = buildWhereClause(workspace.id, {
    status: statusFilter || undefined,
    source: sourceFilter || undefined,
    vehicleId: vehicleFilter || undefined,
    from: fromDate,
    to: toDate,
  });

  const [{ locale, messages }, allMatchingOrders, vehicles] = await Promise.all([
    getI18n(),
    fetchFilteredOrders(where),
    prisma.vehicle.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { nickname: "asc" },
    }),
  ]);

  const orderMessages = messages.orders;
  const orderStatusOptions = getOrderStatusOptions(locale);

  // Apply free-text search after the structured DB filter. We keep this
  // in JS because (a) SQLite + Prisma doesn't ship case-insensitive
  // LIKE without a raw query and (b) the `normalizeText` helper does
  // diacritic stripping the DB can't replicate easily.
  const searchedOrders = searchQuery
    ? allMatchingOrders.filter((order) => matchesOrderSearch(order, searchQuery, locale))
    : allMatchingOrders;

  // Pagination math. Total comes from the post-search list (so the
  // user sees the count of what they actually asked for, not the
  // count of orders in the workspace).
  const totalCount = searchedOrders.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const currentPage = Math.min(requestedPageSafe, totalPages);
  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const endIndex = Math.min(startIndex + PAGE_SIZE, totalCount);
  const pageOrders = searchedOrders.slice(startIndex, endIndex);

  const activeFilterCount = [
    statusFilter,
    sourceFilter,
    vehicleFilter,
    fromFilterRaw,
    toFilterRaw,
  ].filter(Boolean).length;
  const hasAnyFilter = activeFilterCount > 0 || Boolean(searchQuery);

  const filterQs = buildFilterQueryString({
    q: searchQuery,
    status: statusFilter,
    source: sourceFilter,
    vehicleId: vehicleFilter,
    from: fromFilterRaw,
    to: toFilterRaw,
  });
  const prevHref =
    currentPage > 1
      ? `/orders?${filterQs ? `${filterQs}&` : ""}page=${currentPage - 1}`
      : null;
  const nextHref =
    currentPage < totalPages
      ? `/orders?${filterQs ? `${filterQs}&` : ""}page=${currentPage + 1}`
      : null;

  const inputClass =
    "h-12 rounded-md border border-[rgba(17,19,24,0.08)] bg-white/84 px-4 text-[13px] text-[color:var(--ink)] outline-none";
  const filterFieldClass =
    "h-11 rounded-md border border-[rgba(17,19,24,0.08)] bg-white/84 px-3 text-[13px] text-[color:var(--ink)] outline-none focus:border-[var(--ink)]";
  const subtleButtonClass =
    "inline-flex h-11 items-center justify-center rounded-full border border-[rgba(17,19,24,0.1)] bg-[rgba(255,255,255,0.76)] px-4 text-[12px] font-semibold text-[color:var(--ink)] backdrop-blur transition hover:border-[rgba(17,19,24,0.22)] hover:bg-white";
  const primaryButtonClass =
    "inline-flex h-11 items-center justify-center rounded-full bg-[var(--accent)] px-4 text-[12px] font-semibold text-white shadow-[0_18px_38px_-20px_rgba(89,60,251,0.75)] transition hover:-translate-y-0.5 hover:bg-[#4830d4]";

  return (
    <div className="space-y-4 lg:space-y-3.5">
      {params.error ? (
        <div className="rounded-lg border border-amber-200/70 bg-[rgba(247,247,247,0.92)] px-5 py-4 text-sm text-amber-700 shadow-[0_16px_40px_-36px_rgba(17,19,24,0.45)]">
          {orderMessages.importedReadOnly}
        </div>
      ) : null}

      {/*
       * Create form is heavy (12 inputs). Collapsed by default on
       * every viewport so the page opens straight to "search +
       * existing orders" — the more common case. Native <details>
       * gives us a free disclosure animation and a working
       * keyboard / a11y focus story without any client JS.
       */}
      <details className="group overflow-hidden rounded-lg border border-[color:var(--line)] bg-[linear-gradient(140deg,rgba(255,255,255,0.92),rgba(247,247,247,0.96))] shadow-[0_24px_60px_-42px_rgba(17,19,24,0.45)]">
        <summary className="tap-press flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-4 sm:px-6 sm:py-5">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.24em] text-[color:var(--ink-soft)] sm:text-xs sm:tracking-[0.28em]">
              {orderMessages.createKicker}
            </p>
            <h2 className="mt-0.5 font-serif text-[1.05rem] font-semibold leading-tight text-[color:var(--ink)] sm:mt-1 sm:text-[1.5rem] lg:text-[1.6rem]">
              {orderMessages.createTitle}
            </h2>
          </div>
          <span
            aria-hidden
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--line)] bg-white text-[var(--ink-soft)] transition group-open:rotate-45 group-open:bg-[var(--ink)] group-open:text-white"
          >
            <span className="text-xl leading-none">+</span>
          </span>
        </summary>

        <div className="border-t border-[var(--line)] px-4 py-4 sm:px-6 sm:py-5">
          <p className="max-w-3xl text-[13px] text-[color:var(--ink-soft)] sm:text-sm">
            {orderMessages.createCopy}
          </p>
          <p className="mt-2 text-[11px] text-[color:var(--ink-soft)]">
            {orderMessages.createHint}
          </p>

          <form action={saveOfflineOrderAction} className="mt-5 grid gap-3 sm:gap-4 md:grid-cols-2 xl:grid-cols-4">
          <select name="vehicleId" className={inputClass}>
            {vehicles.map((vehicle) => (
              <option key={vehicle.id} value={vehicle.id}>
                {vehicle.nickname}
              </option>
            ))}
          </select>
          <input name="renterName" placeholder={orderMessages.placeholders.renterName} className={inputClass} />
          <input name="renterPhone" placeholder={orderMessages.placeholders.phone} className={inputClass} />
          <select name="status" defaultValue="booked" className={inputClass}>
            {orderStatusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <input name="pickupDatetime" type="datetime-local" className={inputClass} />
          <input name="returnDatetime" type="datetime-local" className={inputClass} />
          <input
            name="totalPrice"
            type="number"
            step="0.01"
            placeholder={orderMessages.placeholders.totalPrice}
            className={inputClass}
          />
          <input
            name="depositAmount"
            type="number"
            step="0.01"
            placeholder={orderMessages.placeholders.deposit}
            className={inputClass}
          />
          <input
            name="pickupLocation"
            placeholder={orderMessages.placeholders.pickupLocation}
            className={inputClass}
          />
          <input
            name="returnLocation"
            placeholder={orderMessages.placeholders.returnLocation}
            className={inputClass}
          />
          <input
            name="paymentMethod"
            placeholder={orderMessages.placeholders.paymentMethod}
            className={inputClass}
          />
          <input
            name="contractNumber"
            placeholder={orderMessages.placeholders.contractNumber}
            className={inputClass}
          />
          <input
            name="notes"
            placeholder={orderMessages.placeholders.notes}
            className={cn(inputClass, "xl:col-span-4")}
          />
            <div className="flex items-center xl:col-span-4">
              <button className={primaryButtonClass}>{orderMessages.createOfflineOrder}</button>
            </div>
          </form>
        </div>
      </details>

      {/*
       * Search + filters. Single GET form so URL state stays
       * shareable and the browser back button does the right thing.
       * The filter row sits inside <details> on mobile so the page
       * opens to a clean "search + results" view; users who want
       * to slice by status / vehicle / date open the panel.
       */}
      <section className="overflow-hidden rounded-lg border border-[color:var(--line)] bg-[rgba(255,255,255,0.88)] p-4 shadow-[0_20px_50px_-40px_rgba(17,19,24,0.4)] sm:p-5">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-[0.24em] text-[color:var(--ink-soft)]">
              {orderMessages.searchKicker}
            </p>
            <h2 className="mt-0.5 font-serif text-[1.05rem] font-semibold leading-tight text-[color:var(--ink)] sm:text-[1.2rem] lg:text-[1.4rem]">
              {orderMessages.searchTitle}
            </h2>
          </div>
          <p className="text-[12px] text-[color:var(--ink-soft)] lg:text-[13px]">
            {orderMessages.searchSummary(totalCount)}
          </p>
        </div>

        <form method="get" className="mt-3 space-y-3">
          <div className="flex flex-col gap-2.5 md:flex-row md:items-center">
            <input
              name="q"
              defaultValue={searchQuery}
              placeholder={orderMessages.placeholders.search}
              className="h-12 flex-1 rounded-full border border-[rgba(17,19,24,0.08)] bg-white/84 px-5 text-sm text-[color:var(--ink)] outline-none"
            />
            <button className={primaryButtonClass}>{orderMessages.searchAction}</button>
            {hasAnyFilter ? (
              <a href="/orders" className={subtleButtonClass}>
                {orderMessages.clearSearch}
              </a>
            ) : null}
          </div>

          <details
            className="group rounded-lg border border-[color:var(--line)] bg-white/65"
            open={activeFilterCount > 0}
          >
            <summary className="tap-press flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-2.5">
              <span className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.18em] text-[color:var(--ink-soft)]">
                {orderMessages.filters.toggleLabel}
                {activeFilterCount > 0 ? (
                  <span className="rounded-full bg-[var(--ink)] px-2 py-0.5 text-[10px] font-semibold tracking-normal text-white">
                    {orderMessages.filters.activeBadge(activeFilterCount)}
                  </span>
                ) : null}
              </span>
              <span
                aria-hidden
                className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[var(--line)] bg-white text-[var(--ink-soft)] transition group-open:rotate-45 group-open:bg-[var(--ink)] group-open:text-white"
              >
                <span className="text-base leading-none">+</span>
              </span>
            </summary>

            <div className="border-t border-[color:var(--line)] px-4 py-4">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                <label className="block">
                  <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.14em] text-[color:var(--ink-soft)]">
                    {orderMessages.filters.statusLabel}
                  </span>
                  <select name="status" defaultValue={statusFilter} className={cn(filterFieldClass, "w-full")}>
                    <option value="">{orderMessages.filters.allStatuses}</option>
                    {orderStatusOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.14em] text-[color:var(--ink-soft)]">
                    {orderMessages.filters.sourceLabel}
                  </span>
                  <select name="source" defaultValue={sourceFilter} className={cn(filterFieldClass, "w-full")}>
                    <option value="">{orderMessages.filters.allSources}</option>
                    {ORDER_SOURCES.map((source) => (
                      <option key={source} value={source}>
                        {getStatusLabel(source, locale)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.14em] text-[color:var(--ink-soft)]">
                    {orderMessages.filters.vehicleLabel}
                  </span>
                  <select
                    name="vehicleId"
                    defaultValue={vehicleFilter}
                    className={cn(filterFieldClass, "w-full")}
                  >
                    <option value="">{orderMessages.filters.allVehicles}</option>
                    {vehicles.map((vehicle) => (
                      <option key={vehicle.id} value={vehicle.id}>
                        {vehicle.plateNumber
                          ? `${vehicle.plateNumber} · ${vehicle.nickname}`
                          : vehicle.nickname}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.14em] text-[color:var(--ink-soft)]">
                    {orderMessages.filters.fromLabel}
                  </span>
                  <input
                    name="from"
                    type="date"
                    defaultValue={fromFilterRaw}
                    className={cn(filterFieldClass, "w-full")}
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.14em] text-[color:var(--ink-soft)]">
                    {orderMessages.filters.toLabel}
                  </span>
                  <input
                    name="to"
                    type="date"
                    defaultValue={toFilterRaw}
                    className={cn(filterFieldClass, "w-full")}
                  />
                </label>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button className={primaryButtonClass}>{orderMessages.filters.applyAction}</button>
                {hasAnyFilter ? (
                  <a href="/orders" className={subtleButtonClass}>
                    {orderMessages.filters.resetAction}
                  </a>
                ) : null}
              </div>
            </div>
          </details>
        </form>
      </section>

      <section className="grid gap-3 lg:grid-cols-2">
        {pageOrders.length === 0 ? (
          <div className="rounded-lg border border-[color:var(--line)] bg-[rgba(255,255,255,0.88)] px-6 py-8 text-sm text-[color:var(--ink-soft)] shadow-[0_20px_50px_-40px_rgba(17,19,24,0.4)] lg:col-span-2">
            {orderMessages.emptySearch}
          </div>
        ) : null}

        {pageOrders.map((order) => {
          const netEarning = getOrderNetEarning(order.sourceMetadata, order.totalPrice);
          const hasNetEarning = netEarning != null;

          return (
            <article
              key={order.id}
              className="h-fit overflow-hidden rounded-lg border border-[color:var(--line)] bg-[rgba(255,255,255,0.88)] shadow-[0_20px_50px_-40px_rgba(17,19,24,0.4)]"
            >
              <div className="bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(247,247,247,0.98))] px-4 py-4 sm:px-5 sm:py-5">
                <div className="flex flex-col gap-3 sm:gap-4 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <h3 className="font-serif text-[1.05rem] font-semibold leading-tight text-[color:var(--ink)] sm:text-[1.5rem] lg:text-[1.7rem]">
                      {order.vehicle.nickname} · {order.renterName}
                    </h3>
                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[11px] text-[color:var(--ink-soft)] sm:mt-3 sm:gap-2">
                      <span className="rounded-full bg-white/76 px-2.5 py-1 font-semibold shadow-[0_14px_28px_-24px_rgba(17,19,24,0.45)] sm:px-3">
                        {orderMessages.platePrefix}: {order.vehicle.plateNumber || "—"}
                      </span>
                      <span className="rounded-full bg-white/56 px-2.5 py-1 sm:px-3">
                        {orderMessages.ownerPrefix}: {order.vehicle.owner?.name ?? "—"}
                      </span>
                    </div>
                    <p className="mt-2.5 text-[12px] leading-snug text-[color:var(--ink-soft)] sm:mt-3 sm:text-sm">
                      {formatDateTime(order.pickupDatetime, locale)} —{" "}
                      {formatDateTime(order.returnDatetime, locale)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5 sm:gap-2">
                    <StatusBadge value={order.source} locale={locale} />
                    <StatusBadge value={order.status} locale={locale} />
                    {order.hasConflict ? <StatusBadge value="conflict" locale={locale} /> : null}
                  </div>
                </div>

                <div className="mt-3.5 grid gap-2.5 text-[13px] text-[color:var(--ink)] sm:mt-4 sm:gap-3 sm:text-sm sm:grid-cols-2 xl:grid-cols-3">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--ink-soft)]">
                      {orderMessages.phone}
                    </p>
                    <p className="mt-1 font-semibold">{order.renterPhone || "—"}</p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--ink-soft)]">
                      {orderMessages.pickup}
                    </p>
                    <p className="mt-1 font-semibold">{order.pickupLocation || "—"}</p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--ink-soft)]">
                      {orderMessages.return}
                    </p>
                    <p className="mt-1 font-semibold">{order.returnLocation || "—"}</p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--ink-soft)]">
                      {orderMessages.payment}
                    </p>
                    <p className="mt-1 font-semibold">{order.paymentMethod || "—"}</p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--ink-soft)]">
                      {orderMessages.contract}
                    </p>
                    <p className="mt-1 font-semibold">{order.contractNumber || "—"}</p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--ink-soft)]">
                      {orderMessages.createdBy}
                    </p>
                    <p className="mt-1 font-semibold">{order.createdBy}</p>
                  </div>
                </div>

                {hasNetEarning ? (
                  <div className="mt-4 overflow-hidden rounded-lg border border-[rgba(17,19,24,0.06)] bg-[linear-gradient(180deg,rgba(17,19,24,0.96),rgba(24,30,41,0.96))] px-4 py-4 text-white">
                    <p className="text-[11px] uppercase tracking-[0.22em] text-white/60">
                      {orderMessages.importedBreakdown}
                    </p>
                    <div className="mt-3 rounded-md bg-white/8 px-4 py-3">
                      <p className="text-[11px] uppercase tracking-[0.18em] text-white/55">
                        {orderMessages.revenuePrefix}
                      </p>
                      <p className="mt-2 text-xl font-semibold text-white">
                        {formatCurrency(netEarning, locale)}
                      </p>
                    </div>
                  </div>
                ) : null}

                <div className="mt-4 flex flex-col gap-3">
                  <form action={updateOrderStatusAction} className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <input type="hidden" name="id" value={order.id} />
                    <select
                      name="status"
                      defaultValue={order.status}
                      className="h-11 rounded-full border border-[rgba(17,19,24,0.08)] bg-white/84 px-4 text-sm text-[color:var(--ink)]"
                    >
                      {orderStatusOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <button className={subtleButtonClass}>{orderMessages.updateStatus}</button>
                  </form>

                  {order.source === "offline" ? (
                    <form action={deleteOrderAction}>
                      <input type="hidden" name="id" value={order.id} />
                      <button className="inline-flex h-11 items-center justify-center rounded-full border border-rose-200 bg-white/76 px-4 text-sm font-semibold text-rose-600 transition hover:border-rose-400 hover:text-rose-700">
                        {orderMessages.deleteOfflineOrder}
                      </button>
                    </form>
                  ) : null}
                </div>
              </div>

              {order.source === "offline" ? (
                <details className="border-t border-[color:var(--line)] bg-[rgba(255,255,255,0.38)] px-5 py-4">
                  <summary className="cursor-pointer list-none text-sm font-semibold text-[color:var(--ink)]">
                    {orderMessages.editOfflineOrder}
                  </summary>
                  <form action={saveOfflineOrderAction} className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <input type="hidden" name="id" value={order.id} />
                    <select name="vehicleId" defaultValue={order.vehicleId} className={inputClass}>
                      {vehicles.map((vehicle) => (
                        <option key={vehicle.id} value={vehicle.id}>
                          {vehicle.nickname}
                        </option>
                      ))}
                    </select>
                    <input name="renterName" defaultValue={order.renterName} className={inputClass} />
                    <input
                      name="renterPhone"
                      defaultValue={order.renterPhone ?? ""}
                      className={inputClass}
                    />
                    <select name="status" defaultValue={order.status} className={inputClass}>
                      {orderStatusOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <input
                      name="pickupDatetime"
                      type="datetime-local"
                      defaultValue={new Date(order.pickupDatetime).toISOString().slice(0, 16)}
                      className={inputClass}
                    />
                    <input
                      name="returnDatetime"
                      type="datetime-local"
                      defaultValue={new Date(order.returnDatetime).toISOString().slice(0, 16)}
                      className={inputClass}
                    />
                    <input
                      name="totalPrice"
                      type="number"
                      step="0.01"
                      defaultValue={order.totalPrice ?? ""}
                      className={inputClass}
                    />
                    <input
                      name="depositAmount"
                      type="number"
                      step="0.01"
                      defaultValue={order.depositAmount ?? ""}
                      className={inputClass}
                    />
                    <input
                      name="pickupLocation"
                      defaultValue={order.pickupLocation ?? ""}
                      className={inputClass}
                    />
                    <input
                      name="returnLocation"
                      defaultValue={order.returnLocation ?? ""}
                      className={inputClass}
                    />
                    <input
                      name="paymentMethod"
                      defaultValue={order.paymentMethod ?? ""}
                      className={inputClass}
                    />
                    <input
                      name="contractNumber"
                      defaultValue={order.contractNumber ?? ""}
                      className={inputClass}
                    />
                    <input
                      name="notes"
                      defaultValue={getDisplayOrderNote(order.notes, order.source) ?? ""}
                      className={cn(inputClass, "xl:col-span-4")}
                    />
                    <div className="flex items-center xl:col-span-4">
                      <button className={primaryButtonClass}>{orderMessages.saveOfflineOrder}</button>
                    </div>
                  </form>
                </details>
              ) : null}
            </article>
          );
        })}
      </section>

      {totalCount > PAGE_SIZE ? (
        <nav
          aria-label="Pagination"
          className="flex flex-col items-center gap-2 rounded-lg border border-[color:var(--line)] bg-[rgba(255,255,255,0.88)] px-4 py-3 shadow-[0_20px_50px_-40px_rgba(17,19,24,0.4)] sm:flex-row sm:justify-between"
        >
          <p className="text-[12px] text-[color:var(--ink-soft)]">
            {orderMessages.pagination.showingRange(startIndex + 1, endIndex, totalCount)}
          </p>
          <div className="flex items-center gap-2">
            {prevHref ? (
              <Link href={prevHref} className={subtleButtonClass}>
                ← {orderMessages.pagination.previous}
              </Link>
            ) : (
              <span className={cn(subtleButtonClass, "cursor-not-allowed opacity-40")}>
                ← {orderMessages.pagination.previous}
              </span>
            )}
            <span className="rounded-full bg-[var(--ink)] px-3 py-1.5 text-[12px] font-semibold text-white">
              {orderMessages.pagination.pageOf(currentPage, totalPages)}
            </span>
            {nextHref ? (
              <Link href={nextHref} className={subtleButtonClass}>
                {orderMessages.pagination.next} →
              </Link>
            ) : (
              <span className={cn(subtleButtonClass, "cursor-not-allowed opacity-40")}>
                {orderMessages.pagination.next} →
              </span>
            )}
          </div>
        </nav>
      ) : null}
    </div>
  );
}
