"use client";

import { Share, SquarePlus } from "lucide-react";
import { useEffect, useState } from "react";

type Copy = {
  title: string;
  copy: string;
  steps: readonly [string, string, string];
  installed: string;
  notSafari: string;
};

/**
 * Putting TATO on an iPhone's home screen. There is no App Store app for
 * the admin, and Safari hides "Add to Home Screen" two taps deep in the
 * share sheet, so this spells the three taps out with the icons Safari
 * uses. Opened from the home screen, TATO runs full screen and keeps
 * its sign-in (see SessionExpiryRedirect and the sliding session).
 */
export function IosInstallGuide({ t }: { t: Copy }) {
  const [state, setState] = useState<"unknown" | "installed" | "ios-safari" | "ios-other" | "other">("unknown");

  useEffect(() => {
    const ua = navigator.userAgent;
    const ios = /iPhone|iPad|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (standalone) setState("installed");
    else if (ios) setState(/CriOS|FxiOS|EdgiOS/.test(ua) ? "ios-other" : "ios-safari");
    else setState("other");
  }, []);

  const icons = [
    <Share key="share" className="h-4 w-4" aria-hidden />,
    <SquarePlus key="add" className="h-4 w-4" aria-hidden />,
    <span key="add-label" className="text-[11px] font-bold">Add</span>,
  ];

  return (
    <section className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-3 sm:px-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--ink-soft)]">{t.title}</p>
      {state === "installed" ? (
        <p className="mt-1.5 text-[12px] font-semibold text-emerald-700">{t.installed}</p>
      ) : (
        <>
          <p className="mt-1.5 max-w-3xl text-[12px] leading-5 text-[var(--ink-soft)]">{t.copy}</p>
          {state === "ios-other" ? (
            <p className="mt-2 rounded-md bg-amber-50 px-2.5 py-1.5 text-[12px] text-amber-900">{t.notSafari}</p>
          ) : null}
          <ol className="mt-3 grid gap-2 sm:grid-cols-3">
            {t.steps.map((step, index) => (
              <li key={step} className="flex items-center gap-2.5 rounded-md bg-[var(--surface-muted)] px-3 py-2 text-[12px] text-[var(--ink)]">
                <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--line)] bg-white text-[#0a84ff]">
                  {icons[index]}
                </span>
                <span>
                  <span className="mr-1 font-semibold tabular-nums text-[var(--ink-soft)]">{index + 1}.</span>
                  {step}
                </span>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
