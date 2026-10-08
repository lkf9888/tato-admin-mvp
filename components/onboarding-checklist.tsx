"use client";

import { Check } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { getMessages, type Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type StepKey = "vehicle" | "trips" | "owner" | "commission" | "share" | "team";
type Step = { key: StepKey; href: string; done: boolean };

/**
 * The first-run list on the dashboard: each step a link to where it is
 * done, ticked from the account's own data. Disappears once every step
 * is done; "hide" keeps it away on this browser before that.
 */
export function OnboardingChecklist({
  workspaceId,
  steps,
  locale,
}: {
  workspaceId: string;
  steps: Step[];
  locale: Locale;
}) {
  // Read here, not passed in: the copy has functions, which cannot cross
  // from the server page to a client component.
  const t = getMessages(locale).dashboard.onboarding;
  const storageKey = `tato-onboarding-hidden:${workspaceId}`;
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    try {
      setHidden(window.localStorage.getItem(storageKey) === "1");
    } catch {
      setHidden(false);
    }
  }, [storageKey]);

  if (hidden) return null;
  const done = steps.filter((step) => step.done).length;

  return (
    <section className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3 sm:p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[14px] font-semibold text-[var(--ink)]">{t.title}</h2>
          <p className="mt-0.5 text-[11.5px] text-[var(--ink-soft)]">{t.progress(done, steps.length)}</p>
        </div>
        <button
          type="button"
          className="text-[11.5px] text-[var(--ink-soft)] underline underline-offset-2 hover:text-[var(--ink)]"
          onClick={() => {
            setHidden(true);
            try {
              window.localStorage.setItem(storageKey, "1");
            } catch {
              // A private window keeps it hidden until reload, which is fine.
            }
          }}
        >
          {t.hide}
        </button>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--surface-muted)]">
        <div className="h-full rounded-full bg-[var(--accent)] transition-all" style={{ width: `${(done / steps.length) * 100}%` }} />
      </div>
      <ol className="mt-3 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {steps.map((step, index) => (
          <li key={step.key}>
            <Link
              href={step.href}
              className={cn(
                "tap-press flex h-full items-start gap-2.5 rounded-md border px-3 py-2 transition",
                step.done
                  ? "border-transparent bg-[var(--surface-muted)]/60 text-[var(--ink-soft)]"
                  : "border-[var(--line)] bg-white hover:border-[var(--accent)]",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
                  step.done ? "bg-emerald-600 text-white" : "border border-[var(--line-strong)] text-[var(--ink-soft)]",
                )}
              >
                {step.done ? <Check className="h-3 w-3" aria-hidden /> : index + 1}
              </span>
              <span className="min-w-0">
                <span className={cn("block text-[12.5px] font-semibold", step.done ? "line-through" : "text-[var(--ink)]")}>
                  {t.steps[step.key].label}
                </span>
                {step.done ? null : (
                  <span className="block text-[11px] leading-4 text-[var(--ink-soft)]">{t.steps[step.key].hint}</span>
                )}
              </span>
            </Link>
          </li>
        ))}
      </ol>
      <Link href="/account-settings#install" className="mt-2.5 inline-block text-[11.5px] text-[var(--brand)] underline underline-offset-2">
        {t.install}
      </Link>
    </section>
  );
}
