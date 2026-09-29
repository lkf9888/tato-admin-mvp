"use client";

import { useEffect, useState } from "react";

/** A small "Copy" that confirms itself for a moment. */
export function CopyTextButton({
  text,
  label,
  copiedLabel,
}: {
  text: string;
  label: string;
  copiedLabel: string;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => setCopied(true));
      }}
      className={`rounded px-1.5 py-0.5 text-[11px] ${
        copied
          ? "bg-[var(--ok-bg)] text-[color:var(--ok-fg)]"
          : "text-[color:var(--ink-soft)] hover:bg-[var(--surface-muted)] hover:text-[color:var(--ink)]"
      }`}
    >
      {copied ? copiedLabel : label}
    </button>
  );
}
