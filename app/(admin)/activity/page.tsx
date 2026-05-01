import Link from "next/link";

import type { Prisma } from "@prisma/client";

import { requireCurrentWorkspace } from "@/lib/auth";
import {
  ACTIVITY_ENTITY_TYPES,
  getActivityActionLabel,
  getActivityActionOptions,
  type ActivityEntityType,
} from "@/lib/i18n";
import { getI18n } from "@/lib/i18n-server";
import { prisma } from "@/lib/prisma";
import { cn, formatDateTime } from "@/lib/utils";

// 30 rows per page is denser than orders (which renders heavy
// cards) since each activity row is a single line. Big enough that
// "what happened today?" fits on one page in a real workspace,
// small enough to keep render cost bounded.
const PAGE_SIZE = 30;

type ActivitySearchParams = {
  page?: string;
  actor?: string;
  action?: string;
  entityType?: string;
  from?: string;
  to?: string;
};

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

function buildFilterQueryString(filters: {
  actor?: string;
  action?: string;
  entityType?: string;
  from?: string;
  to?: string;
}) {
  const params = new URLSearchParams();
  if (filters.actor) params.set("actor", filters.actor);
  if (filters.action) params.set("action", filters.action);
  if (filters.entityType) params.set("entityType", filters.entityType);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  return params.toString();
}

/**
 * Pretty-print the metadata blob if it's valid JSON, otherwise show
 * the raw string. Activity log writes serialize via `JSON.stringify`
 * (see lib/orders.ts:logActivity) so this should always parse.
 */
function formatMetadataDisplay(raw: string | null): string {
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return raw;
  }
}

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<ActivitySearchParams>;
}) {
  const workspace = await requireCurrentWorkspace();
  const params = await searchParams;

  const actorFilter = params.actor?.trim() ?? "";
  const actionFilter = params.action?.trim() ?? "";
  const entityTypeFilter = params.entityType?.trim() ?? "";
  const fromFilterRaw = params.from?.trim() ?? "";
  const toFilterRaw = params.to?.trim() ?? "";
  const fromDate = parseDateParam(fromFilterRaw, "start");
  const toDate = parseDateParam(toFilterRaw, "end");
  const requestedPage = Number.parseInt(params.page ?? "1", 10);
  const requestedPageSafe = Number.isFinite(requestedPage) && requestedPage >= 1 ? requestedPage : 1;

  const where: Prisma.ActivityLogWhereInput = { workspaceId: workspace.id };
  if (actorFilter) {
    // SQLite + Prisma can't do case-insensitive LIKE without raw SQL.
    // We use `contains` (case-sensitive substring match) which is
    // good enough for actor names that are entered consistently
    // (typically email-style or fixed display names).
    where.actor = { contains: actorFilter };
  }
  if (actionFilter) where.action = actionFilter;
  if (entityTypeFilter) where.entityType = entityTypeFilter;
  if (fromDate || toDate) {
    where.createdAt = {};
    if (fromDate) (where.createdAt as { gte?: Date }).gte = fromDate;
    if (toDate) (where.createdAt as { lte?: Date }).lte = toDate;
  }

  const [{ locale, messages }, totalCount] = await Promise.all([
    getI18n(),
    prisma.activityLog.count({ where }),
  ]);
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const currentPage = Math.min(requestedPageSafe, totalPages);
  const skip = (currentPage - 1) * PAGE_SIZE;

  const rows = await prisma.activityLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    skip,
    take: PAGE_SIZE,
  });

  const t = messages.activityPage;
  const actionOptions = getActivityActionOptions(locale);

  const activeFilterCount = [
    actorFilter,
    actionFilter,
    entityTypeFilter,
    fromFilterRaw,
    toFilterRaw,
  ].filter(Boolean).length;
  const hasAnyFilter = activeFilterCount > 0;

  const filterQs = buildFilterQueryString({
    actor: actorFilter,
    action: actionFilter,
    entityType: entityTypeFilter,
    from: fromFilterRaw,
    to: toFilterRaw,
  });
  const prevHref =
    currentPage > 1
      ? `/activity?${filterQs ? `${filterQs}&` : ""}page=${currentPage - 1}`
      : null;
  const nextHref =
    currentPage < totalPages
      ? `/activity?${filterQs ? `${filterQs}&` : ""}page=${currentPage + 1}`
      : null;

  const startIndex = totalCount === 0 ? 0 : skip + 1;
  const endIndex = Math.min(skip + PAGE_SIZE, totalCount);

  const filterFieldClass =
    "h-11 w-full rounded-md border border-[rgba(17,19,24,0.08)] bg-white/84 px-3 text-[13px] text-[color:var(--ink)] outline-none focus:border-[var(--ink)]";
  const subtleButtonClass =
    "inline-flex h-11 items-center justify-center rounded-full border border-[rgba(17,19,24,0.1)] bg-[rgba(255,255,255,0.76)] px-4 text-[12px] font-semibold text-[color:var(--ink)] backdrop-blur transition hover:border-[rgba(17,19,24,0.22)] hover:bg-white";
  const primaryButtonClass =
    "inline-flex h-11 items-center justify-center rounded-full bg-[var(--accent)] px-4 text-[12px] font-semibold text-white shadow-[0_18px_38px_-20px_rgba(89,60,251,0.75)] transition hover:-translate-y-0.5 hover:bg-[#4830d4]";

  return (
    <div className="space-y-4 lg:space-y-3.5">
      <section className="overflow-hidden rounded-lg border border-[color:var(--line)] bg-[linear-gradient(140deg,rgba(255,255,255,0.92),rgba(247,247,247,0.96))] p-4 shadow-[0_24px_60px_-42px_rgba(17,19,24,0.45)] sm:p-5">
        <p className="text-[10px] uppercase tracking-[0.24em] text-[color:var(--ink-soft)] sm:text-[11px] sm:tracking-[0.28em]">
          {t.kicker}
        </p>
        <h2 className="mt-0.5 font-serif text-[1.05rem] font-semibold leading-tight text-[color:var(--ink)] sm:mt-1 sm:text-[1.5rem] lg:text-[1.6rem]">
          {t.title}
        </h2>
        <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-[color:var(--ink-soft)] sm:text-sm">
          {t.copy}
        </p>
        <p className="mt-3 text-[12px] text-[color:var(--ink-soft)] sm:text-[13px]">
          {t.summary(totalCount)}
        </p>
      </section>

      <section className="overflow-hidden rounded-lg border border-[color:var(--line)] bg-[rgba(255,255,255,0.88)] p-4 shadow-[0_20px_50px_-40px_rgba(17,19,24,0.4)] sm:p-5">
        <form method="get" className="space-y-3">
          <details
            className="group rounded-lg border border-[color:var(--line)] bg-white/65"
            open={activeFilterCount > 0}
          >
            <summary className="tap-press flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-2.5">
              <span className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.18em] text-[color:var(--ink-soft)]">
                {t.filters.toggleLabel}
                {activeFilterCount > 0 ? (
                  <span className="rounded-full bg-[var(--ink)] px-2 py-0.5 text-[10px] font-semibold tracking-normal text-white">
                    {t.filters.activeBadge(activeFilterCount)}
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
                    {t.filters.actorLabel}
                  </span>
                  <input
                    name="actor"
                    defaultValue={actorFilter}
                    placeholder={t.filters.actorPlaceholder}
                    className={filterFieldClass}
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.14em] text-[color:var(--ink-soft)]">
                    {t.filters.actionLabel}
                  </span>
                  <select name="action" defaultValue={actionFilter} className={filterFieldClass}>
                    <option value="">{t.filters.allActions}</option>
                    {actionOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.14em] text-[color:var(--ink-soft)]">
                    {t.filters.entityTypeLabel}
                  </span>
                  <select
                    name="entityType"
                    defaultValue={entityTypeFilter}
                    className={filterFieldClass}
                  >
                    <option value="">{t.filters.allEntityTypes}</option>
                    {ACTIVITY_ENTITY_TYPES.map((entityType) => (
                      <option key={entityType} value={entityType}>
                        {entityType}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.14em] text-[color:var(--ink-soft)]">
                    {t.filters.fromLabel}
                  </span>
                  <input
                    name="from"
                    type="date"
                    defaultValue={fromFilterRaw}
                    className={filterFieldClass}
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.14em] text-[color:var(--ink-soft)]">
                    {t.filters.toLabel}
                  </span>
                  <input
                    name="to"
                    type="date"
                    defaultValue={toFilterRaw}
                    className={filterFieldClass}
                  />
                </label>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button className={primaryButtonClass}>{t.filters.applyAction}</button>
                {hasAnyFilter ? (
                  <a href="/activity" className={subtleButtonClass}>
                    {t.filters.resetAction}
                  </a>
                ) : null}
              </div>
            </div>
          </details>
        </form>
      </section>

      <section className="overflow-hidden rounded-lg border border-[color:var(--line)] bg-[rgba(255,255,255,0.88)] shadow-[0_20px_50px_-40px_rgba(17,19,24,0.4)]">
        {rows.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-[color:var(--ink-soft)]">
            {t.empty}
          </div>
        ) : (
          <ul className="divide-y divide-[color:var(--line)]">
            {rows.map((row) => {
              const metadata = formatMetadataDisplay(row.metadata);
              const knownEntityType = (ACTIVITY_ENTITY_TYPES as readonly string[]).includes(
                row.entityType,
              )
                ? (row.entityType as ActivityEntityType)
                : null;

              return (
                <li key={row.id} className="px-4 py-4 sm:px-5">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="font-semibold text-[14px] text-[color:var(--ink)] sm:text-[15px]">
                        {getActivityActionLabel(row.action, locale)}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[color:var(--ink-soft)]">
                        <span>
                          <span className="text-[color:var(--ink-soft)]/70">{t.row.actorPrefix}: </span>
                          <span className="font-medium text-[color:var(--ink)]">
                            {row.actor || t.row.anonymousActor}
                          </span>
                        </span>
                        <span>
                          <span className="text-[color:var(--ink-soft)]/70">{t.row.entityPrefix}: </span>
                          <span className="font-medium text-[color:var(--ink)]">
                            {knownEntityType ?? row.entityType}
                          </span>
                        </span>
                        <span className="break-all">
                          <span className="text-[color:var(--ink-soft)]/70">{t.row.idPrefix}: </span>
                          <span className="font-mono text-[11px] text-[color:var(--ink)]">
                            {row.entityId}
                          </span>
                        </span>
                      </div>
                    </div>
                    <p className="shrink-0 text-[11px] tabular-nums text-[color:var(--ink-soft)] sm:text-[12px]">
                      {formatDateTime(row.createdAt, locale)}
                    </p>
                  </div>

                  {metadata ? (
                    <details className="mt-2.5">
                      <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--ink-soft)] hover:text-[color:var(--ink)]">
                        {t.row.viewMetadata}
                      </summary>
                      <pre className="mt-2 overflow-x-auto rounded-md bg-[rgba(17,19,24,0.04)] p-3 text-[11px] leading-snug text-[color:var(--ink)]">
                        {metadata}
                      </pre>
                    </details>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {totalCount > PAGE_SIZE ? (
        <nav
          aria-label="Pagination"
          className="flex flex-col items-center gap-2 rounded-lg border border-[color:var(--line)] bg-[rgba(255,255,255,0.88)] px-4 py-3 shadow-[0_20px_50px_-40px_rgba(17,19,24,0.4)] sm:flex-row sm:justify-between"
        >
          <p className="text-[12px] text-[color:var(--ink-soft)]">
            {t.pagination.showingRange(startIndex, endIndex, totalCount)}
          </p>
          <div className="flex items-center gap-2">
            {prevHref ? (
              <Link href={prevHref} className={subtleButtonClass}>
                ← {t.pagination.previous}
              </Link>
            ) : (
              <span className={cn(subtleButtonClass, "cursor-not-allowed opacity-40")}>
                ← {t.pagination.previous}
              </span>
            )}
            <span className="rounded-full bg-[var(--ink)] px-3 py-1.5 text-[12px] font-semibold text-white">
              {t.pagination.pageOf(currentPage, totalPages)}
            </span>
            {nextHref ? (
              <Link href={nextHref} className={subtleButtonClass}>
                {t.pagination.next} →
              </Link>
            ) : (
              <span className={cn(subtleButtonClass, "cursor-not-allowed opacity-40")}>
                {t.pagination.next} →
              </span>
            )}
          </div>
        </nav>
      ) : null}
    </div>
  );
}
