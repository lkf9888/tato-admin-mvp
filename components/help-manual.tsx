"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Lightbulb, MessageSquare, X } from "lucide-react";

import type { HelpCopy, ResolvedGuide, ResolvedShot } from "@/app/(admin)/help/guides/types";
import { NAV_ICONS, type NavIconName } from "@/components/nav-icons";
import { cn } from "@/lib/utils";

/** Each guide's sidebar icon, so the list reads like the nav it explains. */
const GUIDE_ICONS: Record<string, NavIconName> = {
  dashboard: "dashboard",
  assistant: "assistant",
  messages: "messages",
  updates: "turoUpdates",
  calendar: "calendar",
  orders: "orders",
  imports: "imports",
  vehicles: "vehicles",
  "vehicle-roi": "vehicleRoi",
  owners: "owners",
  "direct-booking": "directBooking",
  "staff-schedule": "staffSchedule",
  contracts: "contracts",
  inspections: "photos",
  photos: "photos",
  documents: "documents",
  activity: "activity",
  trash: "activity",
  billing: "billing",
  payouts: "payouts",
  invoices: "invoices",
  "account-settings": "accountSettings",
};

/**
 * The guide list and the open guide: a list on the left on a desktop,
 * a picker on a phone. The open guide lives in the address bar
 * (`?page=calendar`), so a link can point straight at one -- and it is
 * written with `replaceState`, since the server has already sent every
 * guide and switching between them needs no round-trip.
 */
export function HelpManual({
  copy,
  guides,
  initialKey,
}: {
  copy: HelpCopy;
  guides: ResolvedGuide[];
  initialKey: string;
}) {
  const [key, setKey] = useState(initialKey);
  const articleRef = useRef<HTMLElement | null>(null);
  const [enlarged, setEnlarged] = useState<{ shot: ResolvedShot; alt: string } | null>(null);
  const guide = guides.find((item) => item.key === key) ?? guides[0];

  const choose = (next: string) => {
    setKey(next);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("page", next);
      window.history.replaceState(null, "", url);
    } catch {
      // The guide still switches; only the address is left as it was.
    }
  };

  // A new guide starts at its top, not wherever the last one was read to.
  useEffect(() => {
    const node = articleRef.current;
    if (!node) return;
    if (node.getBoundingClientRect().top < 0) node.scrollIntoView({ block: "start" });
  }, [key]);

  return (
    <div className="mx-auto w-full max-w-6xl">
      <header className="mb-5">
        <h1 className="text-[1.6rem] font-semibold tracking-[-0.01em] text-[var(--ink)]">{copy.title}</h1>
        <p className="mt-1 max-w-[46rem] text-[14px] leading-6 text-[var(--ink-soft)]">{copy.intro}</p>
      </header>

      {guide ? (
        <div className="grid gap-6 md:grid-cols-[13.5rem_minmax(0,1fr)]">
          {/* Phone: a picker. Desktop: the list. */}
          <label className="md:hidden">
            <span className="sr-only">{copy.pick}</span>
            <select
              value={guide.key}
              onChange={(event) => choose(event.target.value)}
              className="h-11 w-full rounded-md border border-[var(--line)] bg-white px-3 text-[15px] text-[var(--ink)]"
            >
              {guides.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.title}
                </option>
              ))}
            </select>
          </label>

          <nav className="hidden md:block" aria-label={copy.pick}>
            <ul className="sticky top-4 space-y-0.5">
              {guides.map((item) => {
                const Icon = NAV_ICONS[GUIDE_ICONS[item.key] ?? "help"];
                const active = item.key === guide.key;
                return (
                  <li key={item.key}>
                    <button
                      type="button"
                      onClick={() => choose(item.key)}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13.5px] transition",
                        active
                          ? "bg-[var(--accent-soft)] font-semibold text-[var(--accent)]"
                          : "text-[var(--ink-mid)] hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]",
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" aria-hidden />
                      <span className="min-w-0 truncate">{item.title}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          <article ref={articleRef} className="min-w-0 scroll-mt-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 max-w-[44rem]">
                <h2 className="text-[1.3rem] font-semibold text-[var(--ink)]">{guide.title}</h2>
                <p className="mt-1 text-[15px] leading-7 text-[var(--ink-mid)]">{guide.summary}</p>
              </div>
              <Link
                href={`/${guide.key}`}
                className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-[var(--line)] bg-white px-3 text-[13px] font-semibold text-[var(--ink)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
              >
                {copy.open}
                <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            </div>

            <div className="mt-6 space-y-9">
              {guide.sections.map((section) => (
                <section key={section.heading} className="min-w-0">
                  <h3 className="text-[16px] font-semibold text-[var(--ink)]">{section.heading}</h3>
                  {section.shot ? (
                    <figure className="mt-3">
                      <button
                        type="button"
                        onClick={() =>
                          setEnlarged({
                            shot: section.shot!,
                            alt: copy.screenshotAlt.replace("{page}", `${guide.title} · ${section.heading}`),
                          })
                        }
                        className="block w-full cursor-zoom-in overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--surface-muted)] text-left shadow-[0_18px_40px_-30px_rgba(17,19,24,0.45)]"
                        style={{ maxWidth: Math.min(section.shot.width, 1100) }}
                      >
                        <MarkedShot
                          shot={section.shot}
                          alt={copy.screenshotAlt.replace("{page}", `${guide.title} · ${section.heading}`)}
                        />
                      </button>
                      <figcaption className="mt-1.5 text-[12px] text-[var(--ink-soft)]">{copy.screenshotNote}</figcaption>
                    </figure>
                  ) : null}
                  <ol className="mt-3 max-w-[46rem] space-y-2.5">
                    {section.steps.map((step, index) => {
                      const marked = section.shot?.marks.some((mark) => mark.step === index + 1);
                      return (
                        <li key={index} className="flex gap-3 text-[14.5px] leading-6 text-[var(--ink-mid)]">
                          <span
                            aria-hidden
                            className={cn(
                              "mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums",
                              // The same red as the box on the picture, so
                              // step and box read as one pair.
                              marked
                                ? "bg-[#ff4d4f] text-white"
                                : "bg-[var(--surface-muted)] text-[var(--ink-mid)]",
                            )}
                          >
                            {index + 1}
                          </span>
                          <span className="min-w-0">{step}</span>
                        </li>
                      );
                    })}
                  </ol>
                </section>
              ))}
            </div>

            {guide.tips && guide.tips.length > 0 ? (
              <aside className="mt-6 max-w-[46rem] rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[14px] leading-6 text-amber-900">
                <p className="mb-1.5 flex items-center gap-1.5 font-semibold">
                  <Lightbulb className="h-4 w-4" aria-hidden />
                  {copy.tips}
                </p>
                <ul className="list-disc space-y-1 pl-5">
                  {guide.tips.map((tip, index) => (
                    <li key={index}>{tip}</li>
                  ))}
                </ul>
              </aside>
            ) : null}

            <aside className="mt-8 flex max-w-[46rem] items-start gap-3 border-t border-[var(--line)] pt-5">
              <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ink-soft)]" aria-hidden />
              <div className="text-[14px] leading-6">
                <p className="font-semibold text-[var(--ink)]">{copy.contactTitle}</p>
                <p className="text-[var(--ink-soft)]">{copy.contactBody}</p>
              </div>
            </aside>
          </article>
        </div>
      ) : null}

      {enlarged ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={enlarged.alt}
          className="fixed inset-0 z-[95] flex items-center justify-center bg-black/70 p-3 sm:p-6"
          onClick={() => setEnlarged(null)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setEnlarged(null);
          }}
        >
          <button
            type="button"
            autoFocus
            onClick={() => setEnlarged(null)}
            aria-label={copy.close}
            className="absolute right-3 top-3 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white text-[var(--ink)] shadow"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
          <div
            className="max-h-full w-full overflow-auto rounded-lg bg-white"
            style={{ maxWidth: enlarged.shot.width }}
            onClick={(event) => event.stopPropagation()}
          >
            <MarkedShot shot={enlarged.shot} alt={enlarged.alt} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * A screenshot with numbered boxes over what to press. The boxes are drawn
 * here rather than burnt into the picture, so they stay sharp at any size
 * and a retake moves them with the buttons (see the capture script).
 */
function MarkedShot({ shot, alt }: { shot: ResolvedShot; alt: string }) {
  return (
    <span className="relative block">
      {/* eslint-disable-next-line @next/next/no-img-element -- a static screenshot, sized by its own attributes */}
      <img src={shot.src} alt={alt} width={shot.width} height={shot.height} className="block h-auto w-full" />
      {shot.marks.map((mark) => (
        <span
          key={`${mark.step}-${mark.x}-${mark.y}`}
          aria-hidden
          className="pointer-events-none absolute rounded-md border-2 border-[#ff4d4f] shadow-[0_0_0_3px_rgba(255,77,79,0.22)]"
          style={{
            left: `calc(${mark.x}% - 3px)`,
            top: `calc(${mark.y}% - 3px)`,
            width: `calc(${mark.w}% + 6px)`,
            height: `calc(${mark.h}% + 6px)`,
          }}
        >
          <span className="absolute -left-2.5 -top-2.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#ff4d4f] text-[11px] font-bold leading-none text-white shadow">
            {mark.step}
          </span>
        </span>
      ))}
    </span>
  );
}
