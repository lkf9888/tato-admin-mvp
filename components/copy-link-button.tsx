"use client";

import { useState } from "react";

export function CopyLinkButton({
  url,
  className,
  idleLabel = "Copy link",
  copiedLabel = "Link copied",
}: {
  url: string;
  className?: string;
  idleLabel?: string;
  copiedLabel?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button type="button" onClick={handleCopy} className={className}>
      {copied ? copiedLabel : idleLabel}
    </button>
  );
}
