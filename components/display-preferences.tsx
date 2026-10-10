"use client";

import { Check, Languages, Monitor, Moon, Sun } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import type { Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type Theme = "light" | "dark" | "system";

const LANGUAGES: Array<{ value: Locale; label: string; short: string }> = [
  { value: "zh", label: "简体中文", short: "简" },
  { value: "zh-Hant", label: "繁體中文", short: "繁" },
  { value: "en", label: "English", short: "EN" },
];

const THEME_ICONS = { light: Sun, dark: Moon, system: Monitor } as const;

/**
 * Language and appearance, as two small buttons at the foot of the
 * navigation, beside "Contact". Both are set once and rarely touched,
 * but they are personal and wanted from any page -- a settings card
 * made people go looking. Each opens a short menu upward.
 *
 * Language is saved through /api/locale and the page refreshes into it.
 * Appearance is a cookie the root layout reads, so the next page's first
 * paint is already right, and it applies to this page at once.
 */
export function DisplayPreferences({
  locale,
  preference,
  labels,
  className,
}: {
  locale: Locale;
  preference: Locale | "auto";
  labels: {
    language: string;
    auto: string;
    theme: { title: string; light: string; dark: string; system: string };
  };
  className?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState<"language" | "theme" | null>(null);
  const [theme, setTheme] = useState<Theme>("light");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const current = document.documentElement.dataset.theme;
    setTheme(current === "dark" || current === "system" ? current : "light");
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent) {
        if (event.key === "Escape") setOpen(null);
        return;
      }
      if (!rootRef.current?.contains(event.target as Node)) setOpen(null);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  function chooseLanguage(value: Locale | "auto") {
    setOpen(null);
    if (value === preference) return;
    startTransition(async () => {
      await fetch("/api/locale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: value }),
      });
      router.refresh();
    });
  }

  function chooseTheme(next: Theme) {
    setOpen(null);
    setTheme(next);
    document.cookie = `tato-theme=${next}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    if (next === "light") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = next;
  }

  const current = LANGUAGES.find((option) => option.value === locale);
  const ThemeIcon = THEME_ICONS[theme];
  const triggerClass =
    "tap-press inline-flex h-9 items-center justify-center gap-1 rounded-md border border-[var(--line)] bg-[var(--surface)] px-2 text-[12px] font-semibold text-[var(--ink-mid)] transition hover:border-[var(--ink-soft)] hover:text-[var(--ink)]";
  const menuClass =
    "absolute bottom-full right-0 z-50 mb-1.5 min-w-[9.5rem] rounded-lg border border-[var(--line)] bg-[var(--surface)] p-1 shadow-[0_18px_38px_-18px_rgba(17,19,24,0.45)]";
  const optionClass = (active: boolean) =>
    cn(
      "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] transition",
      active ? "font-semibold text-[var(--ink)]" : "text-[var(--ink-mid)] hover:bg-[var(--surface-muted)]",
    );

  return (
    <div ref={rootRef} className={cn("relative flex items-center gap-1", className)}>
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen(open === "language" ? null : "language")}
          aria-haspopup="menu"
          aria-expanded={open === "language"}
          aria-label={labels.language}
          title={labels.language}
          disabled={isPending}
          className={cn(triggerClass, isPending && "opacity-60")}
        >
          <Languages className="h-4 w-4" aria-hidden />
          <span>{current?.short ?? "EN"}</span>
        </button>
        {open === "language" ? (
          <div role="menu" aria-label={labels.language} className={menuClass}>
            {([{ value: "auto" as const, label: labels.auto }, ...LANGUAGES] as const).map((option) => (
              <button
                key={option.value}
                type="button"
                role="menuitemradio"
                aria-checked={option.value === preference}
                onClick={() => chooseLanguage(option.value)}
                className={optionClass(option.value === preference)}
              >
                <span className="flex-1">{option.label}</span>
                {option.value === preference ? <Check className="h-3.5 w-3.5 text-[var(--brand)]" aria-hidden /> : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen(open === "theme" ? null : "theme")}
          aria-haspopup="menu"
          aria-expanded={open === "theme"}
          aria-label={labels.theme.title}
          title={labels.theme.title}
          className={cn(triggerClass, "w-9 px-0")}
        >
          <ThemeIcon className="h-4 w-4" aria-hidden />
        </button>
        {open === "theme" ? (
          <div role="menu" aria-label={labels.theme.title} className={menuClass}>
            {(["light", "dark", "system"] as const).map((value) => {
              const Icon = THEME_ICONS[value];
              return (
                <button
                  key={value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={theme === value}
                  onClick={() => chooseTheme(value)}
                  className={optionClass(theme === value)}
                >
                  <Icon className="h-4 w-4 opacity-70" aria-hidden />
                  <span className="flex-1">{labels.theme[value]}</span>
                  {theme === value ? <Check className="h-3.5 w-3.5 text-[var(--brand)]" aria-hidden /> : null}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}
