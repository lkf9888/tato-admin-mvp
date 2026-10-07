"use client";

import { useEffect, useState } from "react";

/**
 * What a long Turo task is doing right now: the steps, which one is
 * running, a moving bar and the seconds so far.
 *
 * The bar moves rather than fills. None of these tasks can report how
 * far along they are -- an import is one request -- and a bar that
 * creeps to 90% and sits there is the very thing that makes people
 * refresh. Motion plus a clock says "still working" honestly.
 */
export function TuroTaskProgress({
  steps,
  current,
  startedAt,
  note,
  locale,
}: {
  steps: readonly string[];
  /** Index of the running step; steps before it are done. */
  current: number;
  /** Date.now() when the task began. */
  startedAt: number;
  note?: string;
  locale: "zh" | "en";
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));

  return (
    <div role="status" aria-live="polite" className="rounded-md border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2.5">
      <div className="relative h-1.5 overflow-hidden rounded-full bg-[var(--line)]">
        <div className="absolute inset-y-0 left-0 w-1/3 rounded-full bg-[var(--brand)] animate-[tato-route-progress_1.2s_ease-in-out_infinite] motion-reduce:animate-pulse" />
      </div>
      <ol className="mt-2.5 space-y-1">
        {steps.map((step, index) => {
          const state = index < current ? "done" : index === current ? "running" : "waiting";
          return (
            <li key={step} className="flex items-center gap-2 text-[12px]">
              <span
                aria-hidden
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                  state === "done"
                    ? "bg-[var(--ok-bg)] text-[var(--ok-fg)]"
                    : state === "running"
                      ? "border-2 border-[var(--brand)] border-t-transparent animate-spin"
                      : "border border-[var(--line-strong)]"
                }`}
              >
                {state === "done" ? "✓" : null}
              </span>
              <span
                className={
                  state === "running"
                    ? "font-semibold text-[var(--ink)]"
                    : state === "done"
                      ? "text-[var(--ink-mid)]"
                      : "text-[var(--ink-soft)]"
                }
              >
                {step}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="mt-2 text-[11px] leading-4 text-[var(--ink-soft)]">
        <span className="tabular-nums">{locale === "zh" ? `已用 ${seconds} 秒` : `${seconds}s so far`}</span>
        {note ? ` · ${note}` : ""}
      </p>
    </div>
  );
}

/**
 * Ask before leaving while `busy`. A refresh mid-import does not stop
 * the import on the server -- it only throws away the result, and the
 * person then imports again to find out what happened.
 */
export function useLeaveGuard(busy: boolean) {
  useEffect(() => {
    if (!busy) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [busy]);
}

/** A small spinner for inside a button, next to its "…ing" label. */
export function InlineSpinner({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent align-[-2px] ${className}`}
    />
  );
}

/**
 * Three bouncing dots where an AI answer is about to appear, with the
 * wait in seconds once it passes a few: a model call can take twenty,
 * and a bubble that says only "thinking" for that long looks frozen.
 */
export function TypingDots({ startedAt, locale }: { startedAt: number; locale: "zh" | "en" }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  return (
    <span role="status" className="inline-flex items-center gap-2">
      <span aria-hidden className="inline-flex items-end gap-1">
        {[0, 150, 300].map((delay) => (
          <span
            key={delay}
            className="h-1.5 w-1.5 animate-bounce rounded-full bg-current opacity-70"
            style={{ animationDelay: `${delay}ms` }}
          />
        ))}
      </span>
      {seconds >= 3 ? (
        <span className="text-[11px] tabular-nums opacity-70">
          {locale === "zh" ? `${seconds} 秒` : `${seconds}s`}
        </span>
      ) : null}
    </span>
  );
}
