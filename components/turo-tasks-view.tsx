"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { MobilePageHeader } from "@/components/mobile-chrome";
import { getMessages, type Locale } from "@/lib/i18n";

type Task = {
  id: string;
  code: string;
  stage: string | null;
  title: string;
  brief: string;
  plate: string | null;
  orderId: string | null;
  turoUrl: string | null;
  dueAt: string | null;
  severity: string;
  remindCount: number;
};

/** The trip in order, the way the assistant's ledger is laid out. */
const STAGES = ["before_pickup", "pickup", "on_trip", "after_return", "closing", "tickets", "fleet"] as const;

const SEVERITY_TONE: Record<string, string> = {
  critical: "chip-bad",
  warning: "chip-warn",
  info: "chip-neutral",
};

/**
 * The phone assistant's open Turo list. Overdue tasks lead in red,
 * whatever their stage, because that is the question the page answers:
 * what should already have been done. The rest follow the trip's order.
 * The list arrives sorted (lib/agent-turo-tasks), so grouping keeps it.
 */
export function TuroTasksView({
  locale,
  feed,
  tasks,
}: {
  locale: Locale;
  feed: { lastPushAt: string; stale: boolean } | null;
  tasks: Task[];
}) {
  const t = getMessages(locale).turoTasks;
  // Deadlines and "synced x ago" move while the page is open.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const span = (ms: number) => {
    const minutes = Math.floor(Math.abs(ms) / 60_000);
    if (minutes < 60) return t.minutes(Math.max(1, minutes));
    const hours = Math.floor(minutes / 60);
    if (hours < 48) return t.hours(hours);
    return t.days(Math.floor(hours / 24));
  };

  const groups = useMemo(() => {
    const overdue = tasks.filter((task) => task.dueAt && new Date(task.dueAt).getTime() < now);
    const rest = tasks.filter((task) => !overdue.includes(task));
    const byStage = [...STAGES, "other" as const].map((stage) => ({
      key: stage,
      label: t.stages[stage],
      tasks: rest.filter((task) =>
        stage === "other" ? !task.stage || !(STAGES as readonly string[]).includes(task.stage) : task.stage === stage,
      ),
    }));
    return [
      { key: "overdue", label: t.overdue, tasks: overdue },
      ...byStage,
    ].filter((group) => group.tasks.length > 0);
  }, [tasks, now, t]);

  const syncedAgo = feed
    ? now - new Date(feed.lastPushAt).getTime() < 60_000
      ? t.justNow
      : t.ago(span(now - new Date(feed.lastPushAt).getTime()))
    : null;

  return (
    <div className="space-y-3">
      <MobilePageHeader title={t.title} />

      {feed ? (
        <section
          className={`rounded-lg border px-3 py-2.5 sm:px-4 ${
            feed.stale
              ? "border-amber-300 bg-amber-50 text-amber-900"
              : "border-[var(--line)] bg-[var(--surface)] text-[var(--ink-mid)]"
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2 text-[12px]">
            <span className={feed.stale ? "font-bold" : ""}>{t.syncedAgo(syncedAgo ?? "")}</span>
            <span className="t-meta">{t.count(tasks.length)}</span>
          </div>
          {feed.stale ? (
            <p className="mt-1 text-[12px] leading-5">
              <span className="font-bold">{t.staleTitle}</span> {t.staleBody}
            </p>
          ) : null}
        </section>
      ) : (
        <section className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-4 py-10 text-center">
          <p className="text-[13px] font-bold text-[var(--ink)]">{t.neverTitle}</p>
          <p className="mx-auto mt-1.5 max-w-md text-[12px] leading-5 text-[var(--ink-soft)]">{t.neverBody}</p>
        </section>
      )}

      {feed && tasks.length === 0 ? (
        <section className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-4 py-10 text-center">
          <p className="text-[12.5px] text-[var(--ink-soft)]">{t.allClear}</p>
        </section>
      ) : null}

      {groups.map((group) => (
        <section
          key={group.key}
          className={`overflow-hidden rounded-lg border bg-[var(--surface)] ${
            group.key === "overdue" ? "border-rose-300" : "border-[var(--line)]"
          }`}
        >
          <header
            className={`flex items-center justify-between border-b px-3 py-1.5 sm:px-4 ${
              group.key === "overdue"
                ? "border-rose-200 bg-rose-50 text-rose-700"
                : "border-[var(--line)] bg-[var(--surface-muted)] text-[var(--ink-soft)]"
            }`}
          >
            <span className="t-eyebrow">{group.label}</span>
            <span className="text-[11px] tabular-nums">{group.tasks.length}</span>
          </header>
          <ul className="divide-y divide-[var(--line)]">
            {group.tasks.map((task) => {
              const due = task.dueAt ? new Date(task.dueAt).getTime() - now : null;
              const late = due != null && due < 0;
              return (
                <li key={task.id} className="px-3 py-2.5 sm:px-4">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="rounded bg-[var(--surface-muted)] px-1.5 py-px font-mono text-[11px] font-bold text-[var(--ink-mid)]">
                      {task.code}
                    </span>
                    <span className="text-[13px] font-bold text-[var(--ink)]">{task.title}</span>
                    <span className={`chip ${SEVERITY_TONE[task.severity] ?? "chip-neutral"}`}>
                      {t.severity[task.severity as keyof typeof t.severity] ?? task.severity}
                    </span>
                    {group.key === "overdue" && task.stage && (STAGES as readonly string[]).includes(task.stage) ? (
                      <span className="chip chip-neutral">{t.stages[task.stage as (typeof STAGES)[number]]}</span>
                    ) : null}
                    <span
                      className={`ml-auto text-[11.5px] tabular-nums ${
                        late ? "font-bold text-rose-600" : "text-[var(--ink-soft)]"
                      }`}
                    >
                      {due == null ? t.noDue : late ? t.overdueBy(span(due)) : t.dueIn(span(due))}
                    </span>
                  </div>
                  <p className="mt-1 text-[12.5px] leading-5 text-[var(--ink)]">{task.brief}</p>
                  <div className="tap-row mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-[var(--ink-soft)]">
                    {task.plate ? <span>{task.plate}</span> : null}
                    {task.remindCount > 0 ? <span>{t.reminded(task.remindCount)}</span> : null}
                    {task.orderId ? (
                      <Link
                        href={`/orders/${task.orderId}`}
                        className="font-bold text-[var(--brand)] underline underline-offset-2"
                      >
                        {t.viewOrder}
                      </Link>
                    ) : null}
                    {task.turoUrl ? (
                      <a
                        href={task.turoUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-bold text-[var(--brand)] underline underline-offset-2"
                      >
                        {t.openOnTuro} ↗
                      </a>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
