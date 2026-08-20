"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { getMessages, type Locale } from "@/lib/i18n";

type Kind =
  | "GUEST_MESSAGE"
  | "BOOKING_CREATED"
  | "BOOKING_MODIFIED"
  | "BOOKING_CANCELLED"
  | "TRIP_STARTED"
  | "TRIP_ENDED"
  | "PAYOUT"
  | "SUPPORT"
  | "OTHER";

type Item = {
  id: string;
  kind: Kind;
  receivedAt: string;
  guestName: string | null;
  vehicleLabel: string | null;
  vehiclePlate: string | null;
  turoAccount: string | null;
  headline: string;
  headlineZh: string | null;
  needsAction: boolean;
  turoLink: string | null;
  orderId: string | null;
};

/**
 * Colour carries the kind, so the eye sorts the feed before it reads
 * it. Money and cancellations are the two that change what someone
 * does next, so they are the two that are not grey.
 */
const KIND_TONE: Record<Kind, string> = {
  GUEST_MESSAGE: "bg-[var(--brand-soft)] text-[var(--brand)]",
  BOOKING_CREATED: "chip-ok",
  BOOKING_MODIFIED: "chip-warn",
  BOOKING_CANCELLED: "chip-bad",
  TRIP_STARTED: "chip-neutral",
  TRIP_ENDED: "chip-neutral",
  PAYOUT: "chip-ok",
  SUPPORT: "chip-warn",
  OTHER: "chip-neutral",
};

const FILTERS: (Kind | "ALL")[] = [
  "ALL",
  "GUEST_MESSAGE",
  "BOOKING_CREATED",
  "BOOKING_MODIFIED",
  "BOOKING_CANCELLED",
  "TRIP_STARTED",
  "TRIP_ENDED",
  "PAYOUT",
  "SUPPORT",
];

function dayKey(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function TuroUpdatesFeed({ locale, items }: { locale: Locale; items: Item[] }) {
  const t = getMessages(locale).turoUpdates;
  const [kind, setKind] = useState<Kind | "ALL">("ALL");
  const [openOnly, setOpenOnly] = useState(false);

  const visible = useMemo(
    () =>
      items.filter(
        (item) => (kind === "ALL" || item.kind === kind) && (!openOnly || item.needsAction),
      ),
    [items, kind, openOnly],
  );

  const days = useMemo(() => {
    const now = new Date();
    const todayKey = dayKey(now.toISOString());
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayKey = dayKey(yesterday.toISOString());

    const groups = new Map<string, { label: string; items: Item[] }>();
    for (const item of visible) {
      const key = dayKey(item.receivedAt);
      const d = new Date(item.receivedAt);
      const label =
        key === todayKey
          ? t.today
          : key === yesterdayKey
            ? t.yesterday
            : locale === "en"
              ? d.toLocaleDateString("en-CA", { month: "short", day: "numeric" })
              : `${d.getMonth() + 1}月${d.getDate()}日`;
      const group = groups.get(key) ?? { label, items: [] };
      group.items.push(item);
      groups.set(key, group);
    }
    return [...groups.values()];
  }, [visible, locale, t.today, t.yesterday]);

  return (
    <div className="space-y-3">
      <section className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2.5 sm:px-4">
        {/* Filters scroll rather than wrap: nine of them wrapping to
            three rows on a phone pushes the feed itself below the
            fold, which is the thing the page is for. */}
        <div className="scroll-x tap-row -mx-1 flex items-center gap-1.5 px-1">
          {FILTERS.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setKind(value)}
              className={`tap-press shrink-0 whitespace-nowrap rounded-md px-2.5 py-1.5 text-[11.5px] font-bold transition ${
                kind === value
                  ? "bg-[var(--ink)] text-white"
                  : "border border-[var(--line)] bg-white text-[var(--ink-mid)] hover:bg-[var(--surface-muted)]"
              }`}
            >
              {value === "ALL" ? t.all : t.kinds[value]}
            </button>
          ))}
        </div>

        <div className="mt-2 flex items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-[11.5px] font-bold text-[var(--ink-mid)]">
            <input
              type="checkbox"
              checked={openOnly}
              onChange={(event) => setOpenOnly(event.target.checked)}
            />
            {t.unreadOnly}
          </label>
          <span className="t-meta text-[var(--ink-soft)]">{t.countLabel(visible.length)}</span>
        </div>
      </section>

      {visible.length === 0 ? (
        <section className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-4 py-10 text-center">
          <p className="text-[12.5px] text-[var(--ink-soft)]">{t.empty}</p>
        </section>
      ) : null}

      {days.map((day) => (
        <section
          key={day.label}
          className="overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--surface)]"
        >
          <header className="sticky top-0 z-10 border-b border-[var(--line)] bg-[var(--surface)] px-3 py-2 sm:px-4">
            <span className="t-eyebrow text-[var(--ink-soft)]">{day.label}</span>
          </header>

          <ul className="divide-y divide-[var(--line)]">
            {day.items.map((item) => (
              <li key={item.id} className="px-3 py-2.5 sm:px-4">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={`chip ${KIND_TONE[item.kind]}`}>{t.kinds[item.kind]}</span>
                  {item.needsAction ? (
                    <span className="chip chip-bad">{t.unreadOnly}</span>
                  ) : null}
                  {item.turoAccount ? (
                    <span className="chip chip-neutral">{item.turoAccount}</span>
                  ) : null}
                  <span className="ml-auto text-[10.5px] tabular-nums text-[var(--ink-soft)]">
                    {new Date(item.receivedAt).toLocaleTimeString(
                      locale === "en" ? "en-CA" : "zh-CN",
                      { hour: "2-digit", minute: "2-digit" },
                    )}
                  </span>
                </div>

                <p className="mt-1 text-[12.5px] font-bold leading-5 text-[var(--ink)]">
                  {item.guestName ?? "—"}
                  {item.vehicleLabel ? (
                    <span className="font-normal text-[var(--ink-soft)]">
                      {" · "}
                      {item.vehicleLabel}
                      {item.vehiclePlate ? ` · ${item.vehiclePlate}` : ""}
                    </span>
                  ) : null}
                </p>

                <p className="mt-0.5 line-clamp-2 whitespace-pre-wrap text-[12px] leading-5 text-[var(--ink)]">
                  {item.headline}
                </p>
                {item.headlineZh ? (
                  <p className="mt-0.5 line-clamp-2 border-l-2 border-[var(--brand-soft)] pl-2 text-[12px] leading-5 text-[var(--ink-mid)]">
                    {item.headlineZh}
                  </p>
                ) : null}

                <div className="tap-row mt-1 flex flex-wrap items-center gap-2">
                  {item.orderId ? (
                    <Link
                      href={`/orders/${item.orderId}`}
                      className="inline-flex items-center text-[11.5px] font-bold text-[var(--brand)] underline underline-offset-2"
                    >
                      {t.viewOrder}
                    </Link>
                  ) : null}
                  {item.kind === "GUEST_MESSAGE" || item.kind === "SUPPORT" ? (
                    <Link
                      href="/messages"
                      className="inline-flex items-center text-[11.5px] font-bold text-[var(--brand)] underline underline-offset-2"
                    >
                      {t.viewThread}
                    </Link>
                  ) : null}
                  {item.turoLink ? (
                    <a
                      href={item.turoLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center text-[11.5px] font-bold text-[var(--brand)] underline underline-offset-2"
                    >
                      {t.openOnTuro} ↗
                    </a>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
