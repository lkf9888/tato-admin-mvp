"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import type { Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const LANG_OPTIONS: Array<{ value: Locale; label: string }> = [
  { value: "en", label: "EN" },
  { value: "zh", label: "中文" },
  { value: "zh-Hant", label: "繁中" },
];

function followingHint(locale: Locale): string {
  if (locale === "zh-Hant") return "目前跟隨瀏覽器。";
  if (locale === "zh") return "当前跟随浏览器。";
  return "Currently following the browser.";
}

export function LanguageSwitcher({
  locale,
  preference,
  label,
  hint,
  autoLabel,
  className,
}: {
  locale: Locale;
  preference: Locale | "auto";
  label: string;
  hint: string;
  autoLabel: string;
  className?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const options: Array<{ value: Locale | "auto"; label: string }> = [
    { value: "auto", label: autoLabel },
    ...LANG_OPTIONS,
  ];

  return (
    <div className={cn("rounded-md border border-slate-200 bg-white/70 p-3", className)}>
      <p className="text-xs uppercase tracking-[0.25em] text-slate-500">{label}</p>
      <div className="mt-2 grid grid-cols-4 gap-1.5">
        {options.map((option) => {
          const active = option.value === preference;

          return (
            <button
              key={option.value}
              type="button"
              disabled={active || isPending}
              onClick={() => {
                startTransition(async () => {
                  await fetch("/api/locale", {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ locale: option.value }),
                  });
                  router.refresh();
                });
              }}
              className={cn(
                "rounded-xl px-2 py-2 text-xs font-semibold transition",
                active
                  ? "bg-slate-950 text-white"
                  : "border border-slate-200 bg-white text-slate-700 hover:border-slate-900 hover:text-slate-950",
                isPending && !active ? "opacity-70" : "",
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] text-slate-500">
        {hint}
        {preference === "auto" ? ` ${followingHint(locale)}` : ""}
      </p>
    </div>
  );
}

/**
 * Compact 3-button language switcher for login / register pages where there
 * is no logged-in user yet. No "auto" option here — visitors usually want a
 * deterministic choice on the entry page. Renders inline in the top-right
 * corner.
 */
export function CompactLanguageSwitcher({
  locale,
  className,
}: {
  locale: Locale;
  className?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white/80 p-1 shadow-sm backdrop-blur",
        className,
      )}
    >
      {LANG_OPTIONS.map((option) => {
        const active = option.value === locale;
        return (
          <button
            key={option.value}
            type="button"
            disabled={active || isPending}
            onClick={() => {
              startTransition(async () => {
                await fetch("/api/locale", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ locale: option.value }),
                });
                router.refresh();
              });
            }}
            className={cn(
              "rounded-full px-3 py-1.5 text-xs font-semibold transition",
              active
                ? "bg-slate-950 text-white"
                : "text-slate-700 hover:bg-slate-100",
              isPending && !active ? "opacity-60" : "",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
