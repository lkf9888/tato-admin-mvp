"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

/**
 * A save button that stays on screen for a long settings form.
 *
 * Placed inside the `<form>`, it sticks to the bottom of the viewport
 * (above the phone tab bar), says whether anything has changed since
 * the page loaded, warns before leaving with unsaved edits, and saves
 * on Cmd/Ctrl+S. The form itself is untouched -- still a plain server
 * action -- so this only adds, it cannot break a save.
 */
export function StickySaveBar({
  saveLabel,
  savingLabel,
  dirtyLabel,
  cleanLabel,
  className = "",
}: {
  saveLabel: string;
  savingLabel: string;
  dirtyLabel: string;
  cleanLabel: string;
  className?: string;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const [dirty, setDirty] = useState(false);
  const { pending } = useFormStatus();
  const wasPending = useRef(false);
  const [shortcut, setShortcut] = useState("Ctrl+S");

  useEffect(() => {
    if (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)) setShortcut("⌘S");
  }, []);

  // A finished save is a clean slate, whether or not the page reloads.
  useEffect(() => {
    if (wasPending.current && !pending) setDirty(false);
    wasPending.current = pending;
  }, [pending]);

  useEffect(() => {
    const form = barRef.current?.closest("form");
    if (!form) return;
    const markDirty = () => setDirty(true);
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "s" || !(event.metaKey || event.ctrlKey)) return;
      // Another tab's form on the same page is not this one.
      if (!barRef.current?.offsetParent) return;
      event.preventDefault();
      form.requestSubmit();
    };
    form.addEventListener("input", markDirty);
    form.addEventListener("change", markDirty);
    window.addEventListener("keydown", onKey);
    return () => {
      form.removeEventListener("input", markDirty);
      form.removeEventListener("change", markDirty);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    if (!dirty || pending) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty, pending]);

  return (
    <div
      ref={barRef}
      className={`sticky bottom-[calc(env(safe-area-inset-bottom)+72px)] z-20 flex items-center justify-between gap-3 rounded-lg border px-3 py-2 shadow-[0_18px_40px_-24px_rgba(17,19,24,0.55)] backdrop-blur lg:bottom-3 ${className} ${
        dirty
          ? "border-[#f59e0b]/40 bg-[var(--warn-bg)]/95"
          : "border-[color:var(--line)] bg-[rgba(255,255,255,0.94)]"
      }`}
    >
      <p
        role="status"
        className={`flex min-w-0 items-center gap-2 text-[12px] ${
          dirty ? "font-medium text-[color:var(--warn-fg)]" : "text-[color:var(--ink-soft)]"
        }`}
      >
        <span
          aria-hidden
          className={`h-2 w-2 shrink-0 rounded-full ${dirty ? "bg-[#f59e0b]" : "bg-[color:var(--ok-fg)]"}`}
        />
        <span className="truncate">{dirty ? dirtyLabel : cleanLabel}</span>
      </p>
      <button
        type="submit"
        disabled={pending}
        className="shrink-0 rounded-md bg-[var(--ink)] px-4 py-2 text-[12px] font-medium text-white disabled:opacity-60"
        style={{ backgroundColor: "var(--ink)", color: "var(--surface)" }}
      >
        {pending ? savingLabel : saveLabel}
        <span className="ml-2 hidden text-[10px] text-white/60 sm:inline">{shortcut}</span>
      </button>
    </div>
  );
}
