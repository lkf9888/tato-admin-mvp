"use client";

import { useEffect, useState } from "react";

import { ERROR_COPY, errorLocaleFrom, type ErrorLocale } from "@/lib/error-copy";

/**
 * Route-level error boundary.
 *
 * Until this existed, any unhandled error rendered Next's default
 * page: a bare sentence and a digest hash on a white background, with
 * no way back. That is what an operator saw the morning a bad deploy
 * broke the shell, and the digest -- the one thing on screen -- is
 * useless to them because it only resolves against server logs.
 *
 * So: say plainly that it is our fault not theirs, offer the two
 * things that actually recover (retry, go home), and show the digest
 * as something to quote rather than something to decipher.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // The root layout has already set <html lang> from the admin's language.
  const [locale, setLocale] = useState<ErrorLocale>("zh");
  useEffect(() => setLocale(errorLocaleFrom(document.documentElement.lang)), []);
  const t = ERROR_COPY[locale];

  useEffect(() => {
    // Client-side errors never reach the server log otherwise.
    // eslint-disable-next-line no-console
    console.error("[app-error]", error.digest ?? "(no digest)", error.message);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="w-full max-w-md rounded-lg border border-[var(--line)] bg-[var(--surface)] px-4 py-5 text-center">
        <p className="t-eyebrow text-[var(--ink-soft)]">TATO</p>
        <h1 className="t-title mt-1.5 text-[var(--ink)]">{t.errorTitle}</h1>
        <p className="mt-1.5 text-[12.5px] leading-5 text-[var(--ink-soft)]">
          {t.errorBody}
        </p>

        <div className="tap-row mt-4 flex items-center justify-center">
          <button
            type="button"
            onClick={reset}
            className="tap-press flex flex-1 items-center justify-center rounded-md bg-[var(--ink)] px-3 py-2 text-[12.5px] font-bold text-white transition hover:opacity-90"
          >
            {t.retry}
          </button>
          <a
            href="/dashboard"
            className="tap-press flex flex-1 items-center justify-center rounded-md border border-[var(--line-strong)] bg-white px-3 py-2 text-[12.5px] font-bold text-[var(--ink-mid)] transition hover:bg-[var(--surface-muted)]"
          >
            {t.home}
          </a>
        </div>

        {error.digest ? (
          <p className="mt-3 select-all text-[11px] text-[var(--ink-soft)]">
            {t.digest}
            <span className="ml-1 font-bold tabular-nums text-[var(--ink)]">{error.digest}</span>
          </p>
        ) : null}
      </div>
    </div>
  );
}
