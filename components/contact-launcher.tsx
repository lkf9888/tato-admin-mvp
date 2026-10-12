"use client";

import { MessageSquare } from "lucide-react";

import { OPEN_CONTACT_EVENT } from "@/components/contact-button";

/** "Contact" in the phone's More sheet: opens the same form as the
 *  desktop's floating button. */
export function ContactLauncher({ label }: { label: string }) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(OPEN_CONTACT_EVENT))}
      className="tap-press inline-flex h-9 items-center gap-1.5 rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 text-[12px] font-semibold text-[var(--ink-mid)]"
    >
      <MessageSquare className="h-4 w-4" aria-hidden />
      {label}
    </button>
  );
}
