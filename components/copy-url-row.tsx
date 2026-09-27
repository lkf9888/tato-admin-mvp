"use client";

import { useEffect, useState } from "react";

/** An address the operator will paste somewhere: shown, copyable, openable. */
export function CopyUrlRow({
  url,
  copyLabel,
  copiedLabel,
  openLabel,
}: {
  url: string;
  copyLabel: string;
  copiedLabel: string;
  openLabel: string;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <span className="flex min-w-0 flex-1 items-center gap-1">
      <span className="min-w-0 flex-1 truncate font-medium text-[color:var(--ink)]" title={url}>
        {url}
      </span>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(url).then(() => setCopied(true));
        }}
        className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] ${
          copied
            ? "bg-[var(--ok-bg)] text-[color:var(--ok-fg)]"
            : "text-[color:var(--ink-soft)] hover:bg-[var(--surface-muted)] hover:text-[color:var(--ink)]"
        }`}
      >
        {copied ? copiedLabel : copyLabel}
      </button>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-[color:var(--ink-soft)] hover:bg-[var(--surface-muted)] hover:text-[color:var(--ink)]"
      >
        {openLabel} ↗
      </a>
    </span>
  );
}
