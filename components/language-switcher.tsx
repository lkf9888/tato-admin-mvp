"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { cn } from "@/lib/utils";
import type { Locale } from "@/lib/i18n";

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
    { value: "en", label: "EN" },
    { value: "zh", label: "中文" },
  ];

  return (
    <div className={cn("rounded-2xl border border-slate-200 bg-white/70 p-3", className)}>
      <p className="text-xs uppercase tracking-[0.25em] text-slate-500">{label}</p>
      <div className="mt-2 grid grid-cols-3 gap-2">
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
                "rounded-xl px-3 py-2 text-xs font-semibold transition",
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
        {preference === "auto" ? ` ${locale === "zh" ? "当前跟随浏览器。" : "Currently following the browser."}` : ""}
      </p>
    </div>
  );
}
