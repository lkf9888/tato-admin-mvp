"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

type Theme = "light" | "dark" | "system";

/**
 * Light, dark or the phone's own setting, kept in a cookie so the very
 * first paint of the next page is already right (the root layout reads
 * it). Applied to this page at once, without a reload.
 */
export function ThemeSwitcher({ labels }: { labels: { title: string; hint: string; light: string; dark: string; system: string } }) {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const current = document.documentElement.dataset.theme;
    setTheme(current === "dark" || current === "system" ? current : "light");
  }, []);

  function choose(next: Theme) {
    setTheme(next);
    document.cookie = `tato-theme=${next}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    if (next === "light") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = next;
  }

  return (
    <section className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-3 sm:px-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--ink-soft)]">{labels.title}</p>
      <p className="mt-1.5 max-w-3xl text-[12px] leading-5 text-[var(--ink-soft)]">{labels.hint}</p>
      <div role="radiogroup" aria-label={labels.title} className="mt-3 inline-grid grid-cols-3 gap-1 rounded-md bg-[var(--surface-muted)] p-0.5">
        {(["light", "dark", "system"] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={theme === value}
            onClick={() => choose(value)}
            className={cn(
              "h-8 rounded-[5px] px-4 text-[12px] font-semibold transition",
              theme === value ? "bg-[var(--surface)] text-[var(--ink)] shadow-sm" : "text-[var(--ink-soft)] hover:text-[var(--ink)]",
            )}
          >
            {labels[value]}
          </button>
        ))}
      </div>
    </section>
  );
}
