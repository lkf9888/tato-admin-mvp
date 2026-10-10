"use client";

import { BookOpen, ChevronLeft, ChevronRight, Copy, Download, Layers, Share, SquarePlus } from "lucide-react";
import { useEffect, useState } from "react";

import { BrandMark } from "@/components/brand-mark";
import { getMessages, type Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type Device = "unknown" | "installed" | "ios-safari" | "ios-other" | "android-app" | "other";

/**
 * Getting TATO onto a phone, iPhone and Android side by side.
 *
 * iPhone has no App Store app, and Safari hides "Add to Home Screen" a
 * scroll deep in the share sheet, so each step comes with a drawing of
 * the screen it happens on, the thing to tap ringed in Safari's blue.
 * The drawings are markup, not screenshots, so they read in either
 * language and never show anyone's real data.
 *
 * Android gets the APK. Inside the Android app itself, the shell hands
 * the APK to the phone's own browser to download (MainActivity), so the
 * button says so there.
 */
export function AppInstallGuide({
  locale,
  android,
}: {
  locale: Locale;
  android: { path: string; fileName: string; meta: string } | null;
}) {
  const t = getMessages(locale).accountSettingsPage.install;
  const [device, setDevice] = useState<Device>("unknown");

  useEffect(() => {
    const ua = navigator.userAgent;
    const ios = /iPhone|iPad|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (ua.includes("TATOApp/")) setDevice("android-app");
    else if (standalone) setDevice("installed");
    else if (ios) setDevice(/CriOS|FxiOS|EdgiOS/.test(ua) ? "ios-other" : "ios-safari");
    else setDevice("other");
  }, []);

  const installed = device === "installed" || device === "android-app";

  return (
    <section id="install" className="scroll-mt-20 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-3 sm:px-4">
      <h2 className="text-[1rem] font-semibold text-[var(--ink)]">{t.title}</h2>
      <p className="mt-1.5 max-w-3xl text-[12px] leading-5 text-[var(--ink-soft)]">{t.copy}</p>
      {installed ? <p className="mt-2 text-[12px] font-semibold text-emerald-700">{t.installed}</p> : null}

      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="min-w-0 rounded-md border border-[var(--line)] bg-[var(--surface-muted)] p-3">
          <p className="text-[13px] font-semibold text-[var(--ink)]">{t.iphone}</p>
          <p className="mt-0.5 text-[12px] leading-5 text-[var(--ink-soft)]">{t.iphoneCopy}</p>
          {device === "ios-other" ? (
            <p className="mt-2 rounded-md bg-amber-50 px-2.5 py-1.5 text-[12px] text-amber-900">{t.notSafari}</p>
          ) : null}
          <ol className="mt-3 grid gap-3 sm:grid-cols-3">
            {t.steps.map((step, index) => (
              <li key={step} className="flex min-w-0 flex-col gap-2">
                <PhoneMock>{[<SafariMock key="safari" t={t.mock} />, <ShareSheetMock key="sheet" t={t.mock} />, <AddHomeMock key="add" t={t.mock} />][index]}</PhoneMock>
                <p className="text-[12px] leading-5 text-[var(--ink)]">
                  <span className="mr-1 font-semibold tabular-nums text-[var(--brand)]">{index + 1}.</span>
                  {step}
                </p>
              </li>
            ))}
          </ol>
        </div>

        <div className="min-w-0 rounded-md border border-[var(--line)] bg-[var(--surface-muted)] p-3">
          <p className="text-[13px] font-semibold text-[var(--ink)]">{t.android}</p>
          <p className="mt-0.5 text-[12px] leading-5 text-[var(--ink-soft)]">{t.androidCopy}</p>
          {android ? (
            <>
              {/* A plain anchor: the file is in public/, not a route. */}
              <a href={android.path} download={android.fileName} className="btn-primary mt-3 inline-flex items-center gap-1.5">
                <Download className="h-4 w-4" aria-hidden />
                {t.androidDownload}
              </a>
              {device === "android-app" ? (
                <p className="mt-2 text-[11.5px] leading-4 text-[var(--ink-soft)]">{t.androidInApp}</p>
              ) : null}
              <p className="mt-2 text-[11px] leading-4 tabular-nums text-[var(--ink-soft)]">{android.meta}</p>
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}

type MockCopy = ReturnType<typeof getMessages>["accountSettingsPage"]["install"]["mock"];

/** A phone's screen, drawn light like iOS, whatever the page's theme. */
function PhoneMock({ children }: { children: React.ReactNode }) {
  return (
    <div
      aria-hidden
      className="relative mx-auto aspect-[9/14] w-full max-w-[11.5rem] overflow-hidden rounded-[1.4rem] border-[5px] border-[#1c1c1e] bg-[#f2f2f7] text-[#1c1c1e] shadow-[0_14px_30px_-18px_rgba(17,19,24,0.55)]"
    >
      {children}
    </div>
  );
}

/** The ring around what to tap, in Safari's own blue. */
function Tap({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("relative inline-flex items-center justify-center rounded-md ring-2 ring-[#0a84ff] ring-offset-1", className)}>
      <span className="absolute inset-0 animate-ping rounded-md ring-2 ring-[#0a84ff]/40 motion-reduce:hidden" />
      {children}
    </span>
  );
}

function PageSketch() {
  return (
    <div className="space-y-1.5 px-3 pt-4">
      <div className="flex items-center gap-1.5">
        <BrandMark size={16} className="rounded-[4px]" />
        <span className="h-2 w-12 rounded-full bg-[#d1d1d6]" />
      </div>
      <span className="block h-10 rounded-md bg-white" />
      <span className="block h-2 w-4/5 rounded-full bg-[#d1d1d6]" />
      <span className="block h-2 w-3/5 rounded-full bg-[#d1d1d6]" />
      <span className="block h-8 rounded-md bg-white" />
    </div>
  );
}

function SafariMock({ t }: { t: MockCopy }) {
  return (
    <>
      <PageSketch />
      <div className="absolute inset-x-0 bottom-0 space-y-1.5 border-t border-[#d1d1d6] bg-[#f9f9f9]/95 px-2 pb-2.5 pt-1.5">
        <div className="mx-auto w-[85%] rounded-lg bg-[#e3e3e8] py-1 text-center text-[8px] font-medium">tatocar.co</div>
        <div className="flex items-center justify-between px-1 text-[#0a84ff]">
          <ChevronLeft className="h-3.5 w-3.5" />
          <ChevronRight className="h-3.5 w-3.5 opacity-40" />
          <Tap className="h-5 w-5">
            <Share className="h-3.5 w-3.5" aria-label={t.share} />
          </Tap>
          <BookOpen className="h-3.5 w-3.5" />
          <Layers className="h-3.5 w-3.5" />
        </div>
      </div>
    </>
  );
}

function ShareSheetMock({ t }: { t: MockCopy }) {
  const rows = [
    { label: t.copy, Icon: Copy },
    { label: t.addBookmark, Icon: BookOpen },
    { label: t.addHome, Icon: SquarePlus, tap: true },
  ];
  return (
    <>
      <div className="opacity-40">
        <PageSketch />
      </div>
      <div className="absolute inset-x-0 bottom-0 rounded-t-xl bg-[#f2f2f7] px-2 pb-3 pt-2 shadow-[0_-8px_20px_rgba(0,0,0,0.12)]">
        <div className="mx-auto mb-2 h-1 w-6 rounded-full bg-[#c7c7cc]" />
        <div className="overflow-visible rounded-lg bg-white">
          {rows.map(({ label, Icon, tap }) => {
            const row = (
              <span className="flex w-full items-center justify-between px-2 py-1.5 text-[8.5px]">
                <span className="truncate">{label}</span>
                <Icon className="h-3 w-3 shrink-0" />
              </span>
            );
            return (
              <div key={label} className="border-b border-[#e5e5ea] last:border-b-0">
                {tap ? <Tap className="w-full rounded-[5px]">{row}</Tap> : row}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

function AddHomeMock({ t }: { t: MockCopy }) {
  return (
    <div className="px-2 pt-2">
      <div className="flex items-center justify-between text-[8.5px]">
        <span className="text-[#0a84ff]">{t.cancel}</span>
        <span className="truncate px-1 font-semibold">{t.addHome}</span>
        <Tap className="px-1 py-0.5">
          <span className="font-semibold text-[#0a84ff]">{t.add}</span>
        </Tap>
      </div>
      <div className="mt-3 flex items-center gap-2 rounded-lg bg-white p-2">
        <BrandMark size={30} className="shrink-0 rounded-[7px]" />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="border-b border-[#e5e5ea] pb-0.5 text-[9px] font-medium">TATO</div>
          <div className="truncate text-[7.5px] text-[#8e8e93]">tatocar.co</div>
        </div>
      </div>
      <div className="mt-6 grid grid-cols-4 gap-2 px-1 opacity-60">
        {Array.from({ length: 8 }, (_, index) => (
          <span key={index} className="aspect-square rounded-[6px] bg-[#d1d1d6]" />
        ))}
      </div>
    </div>
  );
}
