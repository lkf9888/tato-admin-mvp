"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { MobilePageHeader } from "@/components/mobile-chrome";
import { getMessages, type Locale } from "@/lib/i18n";
import { shortTuroDateTime } from "@/lib/turo-email-facts";
import type { TuroUpdateDetail, TuroUpdateItem, UpdateCategory } from "@/lib/turo-updates-data";

type Tab = UpdateCategory | "all";
type Page = { items: TuroUpdateItem[]; counts: Record<UpdateCategory, number> | null; nextBefore: string | null };

const TABS: Tab[] = ["action", "booking", "money", "support", "review", "routine", "all"];

/**
 * Colour carries the category, so the eye sorts the list before it
 * reads it. Red is kept for what is waiting on the operator.
 */
const CATEGORY_TONE: Record<UpdateCategory | "guest", string> = {
  action: "chip-bad",
  booking: "chip-ok",
  money: "chip-ok",
  support: "chip-warn",
  review: "chip-neutral",
  routine: "chip-neutral",
  other: "chip-neutral",
  guest: "bg-[var(--brand-soft)] text-[var(--brand)]",
};

function dayKey(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/**
 * The updates page: a list of Turo's mail on the left, sorted into what
 * each asks of the operator, and the one that is open on the right --
 * in full, with the facts it states and the rest of its trip's mail.
 * On a phone the open one takes the screen, as a guest conversation
 * does.
 */
export function TuroUpdatesFeed({
  locale,
  initial,
  initialTab,
}: {
  locale: Locale;
  initial: Page;
  initialTab: Tab;
}) {
  const t = getMessages(locale).turoUpdates;
  const [tab, setTab] = useState<Tab>(initialTab);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState(initial.items);
  const [counts, setCounts] = useState(initial.counts);
  const [nextBefore, setNextBefore] = useState(initial.nextBefore);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, TuroUpdateDetail>>({});
  const firstLoad = useRef(true);

  const fetchPage = useCallback(
    async (before: string | null) => {
      const params = new URLSearchParams({ category: tab });
      if (query.trim()) params.set("q", query.trim());
      if (before) params.set("before", before);
      setLoading(true);
      setFailed(false);
      try {
        const response = await fetch(`/api/messages/updates?${params}`, { cache: "no-store" });
        if (!response.ok) throw new Error(String(response.status));
        const page = (await response.json()) as Page;
        setItems((current) => (before ? [...current, ...page.items] : page.items));
        if (page.counts) setCounts(page.counts);
        setNextBefore(page.nextBefore);
      } catch {
        setFailed(true);
      } finally {
        setLoading(false);
      }
    },
    [tab, query],
  );

  // A new tab or search starts from the top. The first render already
  // has its page from the server.
  useEffect(() => {
    if (firstLoad.current) {
      firstLoad.current = false;
      return;
    }
    const timer = setTimeout(() => void fetchPage(null), query ? 300 : 0);
    return () => clearTimeout(timer);
  }, [fetchPage, query]);

  const detail = selectedId ? details[selectedId] : undefined;
  // An update opened from a trip's timeline may not be in the list (a
  // guest message, or older than the page); its detail stands in.
  const selected =
    items.find((item) => item.id === selectedId) ?? (detail ? itemFromDetail(detail, t.categories.guest) : null);

  // Opening an update reads it, every mail folded into it included.
  useEffect(() => {
    const item = items.find((row) => row.id === selectedId);
    if (!item?.unread) return;
    setItems((current) => current.map((row) => (row.id === item.id ? { ...row, unread: false } : row)));
    void fetch("/api/messages/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emailIds: item.ids }),
    }).catch(() => null);
  }, [selectedId, items]);

  useEffect(() => {
    if (!selectedId || details[selectedId]) return;
    let cancelled = false;
    fetch(`/api/messages/updates/${selectedId}`, { cache: "no-store" })
      .then((response) => (response.ok ? (response.json() as Promise<TuroUpdateDetail>) : null))
      .then((loaded) => {
        if (!cancelled && loaded) setDetails((current) => ({ ...current, [loaded.id]: loaded }));
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, [selectedId, details]);

  const markHandled = useCallback(
    async (item: TuroUpdateItem) => {
      const response = await fetch("/api/messages/acknowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailIds: item.ids }),
      }).catch(() => null);
      if (!response?.ok) return;
      setItems((current) => current.map((row) => (row.id === item.id ? { ...row, needsAction: false } : row)));
      setDetails((current) =>
        current[item.id] ? { ...current, [item.id]: { ...current[item.id], handled: true, open: false } } : current,
      );
      setCounts((current) => (current ? { ...current, action: Math.max(0, current.action - 1) } : current));
    },
    [],
  );

  const days = useMemo(() => {
    const now = new Date();
    const todayKey = dayKey(now.toISOString());
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayKey = dayKey(yesterday.toISOString());
    const groups = new Map<string, { label: string; items: TuroUpdateItem[] }>();
    for (const item of items) {
      const key = dayKey(item.receivedAt);
      const d = new Date(item.receivedAt);
      const label =
        key === todayKey
          ? t.today
          : key === yesterdayKey
            ? t.yesterday
            : locale === "en"
              ? d.toLocaleDateString("en-CA", { month: "short", day: "numeric", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" })
              : `${d.getFullYear() === now.getFullYear() ? "" : `${d.getFullYear()}年`}${d.getMonth() + 1}月${d.getDate()}日`;
      const group = groups.get(key) ?? { label, items: [] };
      group.items.push(item);
      groups.set(key, group);
    }
    return [...groups.entries()].map(([key, group]) => ({ key, ...group }));
  }, [items, locale, t.today, t.yesterday]);

  const timeOf = (iso: string) =>
    new Date(iso).toLocaleTimeString(locale === "en" ? "en-CA" : "zh-CN", { hour: "2-digit", minute: "2-digit" });
  const dateTimeOf = (iso: string) =>
    new Date(iso).toLocaleString(locale === "en" ? "en-CA" : "zh-CN", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  const deadlineChip = (item: { respondBy: string | null; respondByAt: string | null }) => {
    if (!item.respondByAt) return null;
    const overdue = new Date(item.respondByAt).getTime() < Date.now();
    return (
      <span className="chip chip-bad">{overdue ? t.overdue : t.respondBy(dateTimeOf(item.respondByAt))}</span>
    );
  };

  return (
    <div className="space-y-3">
      <MobilePageHeader title={getMessages(locale).shell.nav.turoUpdates} />

      <section className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2.5 sm:px-4">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          {/* Tabs scroll rather than wrap, so the list stays above the
              fold on a phone. */}
          <div className="scroll-x tap-row -mx-1 flex min-w-0 flex-1 items-center gap-1.5 px-1">
            {TABS.map((value) => {
              const count = value === "all" ? null : counts?.[value];
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setTab(value)}
                  className={`tap-press shrink-0 whitespace-nowrap rounded-md px-2.5 py-1.5 text-[11.5px] font-bold transition ${
                    tab === value
                      ? "bg-[var(--ink)] text-white"
                      : "border border-[var(--line)] bg-white text-[var(--ink-mid)] hover:bg-[var(--surface-muted)]"
                  }`}
                >
                  {t.categories[value]}
                  {count ? (
                    <span
                      className={`ml-1 tabular-nums ${
                        value === "action" && tab !== value ? "text-[var(--danger,#c0392b)]" : "opacity-70"
                      }`}
                    >
                      {count}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
          <input
            type="search"
            value={query}
            onChange={(event) => {
              // A search looks across everything: what is open is
              // usually not what is being looked for.
              if (!query && event.target.value && tab === "action") setTab("all");
              setQuery(event.target.value);
            }}
            placeholder={t.search}
            className="h-8 w-full rounded-md border border-[var(--line)] bg-white px-2.5 text-[12px] lg:w-56"
          />
        </div>
      </section>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-3">
          {items.length === 0 && !loading ? (
            <section className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-4 py-10 text-center">
              <p className="text-[12.5px] text-[var(--ink-soft)]">{tab === "action" ? t.emptyAction : t.empty}</p>
              <p className="mt-1 text-[11px] text-[var(--ink-soft)]">{t.guestMessagesNote}</p>
            </section>
          ) : null}

          {days.map((day) => (
            <section key={day.key} className="overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--surface)]">
              <header className="border-b border-[var(--line)] bg-[var(--surface-muted)] px-3 py-1.5">
                <span className="t-eyebrow text-[var(--ink-soft)]">{day.label}</span>
              </header>
              <ul className="divide-y divide-[var(--line)]">
                {day.items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(item.id)}
                      className={`block w-full px-3 py-2 text-left transition hover:bg-[var(--surface-muted)] ${
                        selectedId === item.id ? "bg-[var(--brand-soft)]" : ""
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <span
                          aria-hidden
                          className={`h-1.5 w-1.5 shrink-0 rounded-full ${item.unread ? "bg-[#d64545]" : "bg-transparent"}`}
                        />
                        <span
                          className={`min-w-0 flex-1 truncate text-[12.5px] leading-5 text-[var(--ink)] ${
                            item.unread ? "font-bold" : "font-semibold"
                          }`}
                        >
                          {locale === "en" ? item.titleEn : item.title}
                        </span>
                        <span className="shrink-0 text-[10.5px] tabular-nums text-[var(--ink-soft)]">{timeOf(item.receivedAt)}</span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 pl-3 text-[11.5px] text-[var(--ink-soft)]">
                        <span className="min-w-0 truncate">
                          {[item.vehicleLabel, item.plate].filter(Boolean).join(" · ") || item.subject}
                        </span>
                        {item.ids.length > 1 ? <span className="shrink-0">· {t.merged(item.ids.length)}</span> : null}
                        {item.account ? <span className="chip chip-neutral shrink-0">{item.account}</span> : null}
                      </div>
                      {(locale === "en" ? item.summaryEn : item.summary) ? (
                        <p className="mt-0.5 line-clamp-1 pl-3 text-[11.5px] leading-5 text-[var(--ink-mid)]">
                          {locale === "en" ? item.summaryEn : item.summary}
                        </p>
                      ) : null}
                      {tab === "all" || item.needsAction ? (
                        <div className="mt-1 flex flex-wrap items-center gap-1 pl-3">
                          {tab === "all" ? (
                            <span className={`chip ${CATEGORY_TONE[item.category]}`}>{t.categories[item.category]}</span>
                          ) : null}
                          {item.needsAction ? deadlineChip(item) : null}
                        </div>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          {failed ? <p className="text-center text-[12px] text-[var(--ink-soft)]">{t.loadFailed}</p> : null}
          {nextBefore || loading ? (
            <button
              type="button"
              disabled={loading}
              onClick={() => void fetchPage(nextBefore)}
              className="tap-press w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] py-2.5 text-[12px] font-bold text-[var(--ink-mid)]"
            >
              {loading ? t.loading : t.loadMore}
            </button>
          ) : null}
        </div>

        {/* The open update. A sticky panel beside the list on a wide
            screen; the whole screen on a phone. */}
        {selected ? (
          <section className="fixed inset-x-0 top-0 z-[60] flex h-dvh min-h-0 flex-col overflow-hidden bg-[var(--surface)] lg:sticky lg:top-3 lg:z-auto lg:h-[calc(100dvh-1.5rem)] lg:rounded-lg lg:border lg:border-[var(--line)]">
            <div className="flex items-center gap-2 border-b border-[var(--line)] px-3 py-2 lg:hidden">
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                className="tap-press rounded-md border border-[var(--line)] px-2.5 py-1 text-[12px] font-bold"
              >
                ← {t.back}
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              <UpdateDetail
                locale={locale}
                item={selected}
                detail={detail}
                onMarkHandled={() => void markHandled(selected)}
                dateTimeOf={dateTimeOf}
                deadlineChip={deadlineChip}
                onOpen={setSelectedId}
              />
            </div>
          </section>
        ) : selectedId ? (
          <section className="fixed inset-x-0 top-0 z-[60] flex h-dvh items-center justify-center bg-[var(--surface)] lg:static lg:h-auto lg:rounded-lg lg:border lg:border-[var(--line)] lg:py-16">
            <p className="text-[12.5px] text-[var(--ink-soft)]">{t.loading}</p>
          </section>
        ) : (
          <section className="hidden rounded-lg border border-dashed border-[var(--line)] px-4 py-16 text-center lg:block">
            <p className="text-[12.5px] text-[var(--ink-soft)]">{t.selectPrompt}</p>
          </section>
        )}
      </div>
    </div>
  );
}

function itemFromDetail(detail: TuroUpdateDetail, guestLabel: string): TuroUpdateItem {
  return {
    id: detail.id,
    ids: [detail.id],
    receivedAt: detail.receivedAt,
    category: detail.category ?? "other",
    title: detail.category ? detail.subject.replace(/^\([^)]*\)\s*[-–—]\s*/, "") : `${detail.guestName ?? ""} · ${guestLabel}`,
    titleEn: detail.subject.replace(/^\([^)]*\)\s*[-–—]\s*/, ""),
    summary: detail.summary,
    summaryEn: detail.summaryEn,
    subject: detail.subject,
    guestName: detail.guestName,
    account: detail.account,
    vehicleLabel: detail.vehicleLabel,
    plate: detail.plate,
    reservationId: detail.reservationId,
    needsAction: detail.open,
    unread: false,
    respondBy: detail.facts.respondBy ?? null,
    respondByAt: detail.facts.respondByAt ?? null,
  };
}

function UpdateDetail({
  locale,
  item,
  detail,
  onMarkHandled,
  dateTimeOf,
  deadlineChip,
  onOpen,
}: {
  locale: Locale;
  item: TuroUpdateItem;
  detail: TuroUpdateDetail | undefined;
  onMarkHandled: () => void;
  dateTimeOf: (iso: string) => string;
  deadlineChip: (item: { respondBy: string | null; respondByAt: string | null }) => React.ReactNode;
  onOpen: (id: string) => void;
}) {
  const t = getMessages(locale).turoUpdates;
  const facts = detail?.facts;
  const change = (now?: string, was?: string, format: (value: string) => string = (value) => value) =>
    now ? (
      <>
        {was ? <s className="mr-1 text-[var(--ink-soft)]">{format(was)}</s> : null}
        {was ? "→ " : null}
        {format(now)}
      </>
    ) : null;

  const rows: [string, React.ReactNode][] = [
    [t.facts.vehicle, detail?.vehicleLabel ? `${detail.vehicleLabel}${detail.plate ? ` · ${detail.plate}` : ""}` : null],
    [t.facts.reservation, detail?.reservationId ? `#${detail.reservationId}` : null],
    [t.facts.tripStart, change(facts?.tripStart, facts?.tripStartWas, shortTuroDateTime)],
    [t.facts.tripEnd, change(facts?.tripEnd, facts?.tripEndWas, shortTuroDateTime)],
    [t.facts.earnings, change(facts?.earnings, facts?.earningsWas)],
    [t.facts.amount, facts?.amount ?? null],
    [t.facts.location, facts?.location ?? null],
    [t.facts.phone, facts?.guestPhone ?? null],
    [t.facts.distance, facts?.distance ?? null],
  ];
  const shown = rows.filter(([, value]) => value);
  const isAction = item.category === "action";
  // Pending: an open request. An old one nobody marked is just history.
  const pending = detail ? detail.open : item.needsAction;
  const handled = detail?.handled ?? false;

  return (
    <article className="space-y-3">
      <header>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`chip ${CATEGORY_TONE[item.category]}`}>{t.categories[item.category]}</span>
          {isAction && handled ? <span className="chip chip-neutral">{t.handled}</span> : null}
          {pending ? deadlineChip(item) : null}
        </div>
        <h2 className="mt-1.5 text-[15px] font-bold leading-6 text-[var(--ink)]">
          {locale === "en" ? item.titleEn : item.title}
        </h2>
        <p className="t-meta mt-0.5 text-[var(--ink-soft)]">
          {dateTimeOf(item.receivedAt)}
          {item.account ? ` · ${t.account(item.account)}` : ""}
          {item.ids.length > 1 ? ` · ${t.merged(item.ids.length)}` : ""}
        </p>
        {(locale === "en" ? item.summaryEn : item.summary) ? (
          <p className="mt-1.5 text-[12.5px] leading-5 text-[var(--ink)]">{locale === "en" ? item.summaryEn : item.summary}</p>
        ) : null}
      </header>

      {shown.length > 0 ? (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 rounded-md bg-[var(--surface-muted)] px-3 py-2.5 text-[12px]">
          {shown.map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-[10.5px] text-[var(--ink-soft)]">{label}</dt>
              <dd className="break-words text-[var(--ink)]">{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {detail?.guestText || facts?.guestNote ? (
        <div className="border-l-2 border-[var(--line)] pl-2.5 text-[12.5px] leading-5" style={{ borderRadius: 0 }}>
          <p className="text-[10.5px] text-[var(--ink-soft)]">{t.guestWrote}</p>
          <p className="whitespace-pre-wrap text-[var(--ink)]">{detail?.guestText ?? facts?.guestNote}</p>
          {detail?.guestText && detail.guestTextZh ? <p className="mt-0.5 text-[var(--ink-mid)]">{detail.guestTextZh}</p> : null}
        </div>
      ) : null}

      <div className="tap-row flex flex-wrap gap-2">
        {detail?.turoLink ? (
          <a
            href={detail.turoLink}
            target="_blank"
            rel="noopener noreferrer"
            className={`tap-press inline-flex h-8 items-center rounded-md px-3 text-[12px] font-bold ${
              pending ? "bg-[var(--ink)] text-white" : "border border-[var(--line)] text-[var(--ink)]"
            }`}
          >
            {isAction ? t.actOnTuro : t.openOnTuro} ↗
          </a>
        ) : null}
        {detail?.order ? (
          <Link
            href={`/orders/${detail.order.id}`}
            className="tap-press inline-flex h-8 items-center rounded-md border border-[var(--line)] px-3 text-[12px] font-bold text-[var(--ink)]"
          >
            {t.viewOrder}
          </Link>
        ) : null}
        {pending ? (
          <button
            type="button"
            onClick={onMarkHandled}
            className="tap-press inline-flex h-8 items-center rounded-md border border-[var(--line)] px-3 text-[12px] font-bold text-[var(--ink)]"
          >
            {t.markHandled}
          </button>
        ) : null}
      </div>

      {detail && detail.timeline.length > 1 ? (
        <section>
          <p className="t-eyebrow text-[var(--ink-soft)]">{t.timeline}</p>
          <ol className="mt-1 space-y-1 border-l border-[var(--line)] pl-3" style={{ borderRadius: 0 }}>
            {detail.timeline.map((entry) => (
              <li key={entry.id} className="relative text-[12px] leading-5">
                <span
                  aria-hidden
                  className={`absolute -left-[15.5px] top-[7px] h-1.5 w-1.5 rounded-full ${
                    entry.current ? "bg-[var(--brand)]" : "bg-[var(--line-strong,#c9c9c9)]"
                  }`}
                />
                <button
                  type="button"
                  onClick={() => onOpen(entry.id)}
                  className={`text-left ${entry.current ? "font-bold text-[var(--ink)]" : "text-[var(--ink-mid)]"}`}
                >
                  <span className="tabular-nums text-[var(--ink-soft)]">{dateTimeOf(entry.receivedAt)}</span>{" "}
                  {entry.title ? (locale === "en" ? entry.titleEn : entry.title) : t.categories.guest}
                  {entry.summary && locale !== "en" ? <span className="text-[var(--ink-soft)]"> · {entry.summary}</span> : null}
                  {entry.current ? <span className="text-[var(--ink-soft)]"> （{t.current}）</span> : null}
                </button>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {detail ? (
        <details className="rounded-md border border-[var(--line)]">
          <summary className="cursor-pointer px-3 py-2 text-[12px] font-bold text-[var(--ink-mid)]">{t.original}</summary>
          <div className="border-t border-[var(--line)] px-3 py-2">
            <p className="text-[11px] text-[var(--ink-soft)]">{detail.subject}</p>
            <p className="mt-2 whitespace-pre-wrap break-words text-[12px] leading-5 text-[var(--ink)]">{detail.body}</p>
          </div>
        </details>
      ) : (
        <p className="text-[12px] text-[var(--ink-soft)]">{t.loading}</p>
      )}
    </article>
  );
}
