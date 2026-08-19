"use client";

import { useEffect } from "react";

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
  useEffect(() => {
    // Client-side errors never reach the server log otherwise.
    // eslint-disable-next-line no-console
    console.error("[app-error]", error.digest ?? "(no digest)", error.message);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="w-full max-w-md rounded-lg border border-[var(--line)] bg-[var(--surface)] px-4 py-5 text-center">
        <p className="t-eyebrow text-[var(--ink-soft)]">TATO</p>
        <h1 className="t-title mt-1.5 text-[var(--ink)]">这个页面没能加载出来</h1>
        <p className="mt-1.5 text-[12.5px] leading-5 text-[var(--ink-soft)]">
          是平台出了问题，不是你的操作有误。你的数据没有受影响。
        </p>

        <div className="tap-row mt-4 flex items-center justify-center">
          <button
            type="button"
            onClick={reset}
            className="tap-press flex flex-1 items-center justify-center rounded-md bg-[var(--ink)] px-3 py-2 text-[12.5px] font-bold text-white transition hover:opacity-90"
          >
            重新加载
          </button>
          <a
            href="/dashboard"
            className="tap-press flex flex-1 items-center justify-center rounded-md border border-[var(--line-strong)] bg-white px-3 py-2 text-[12.5px] font-bold text-[var(--ink-mid)] transition hover:bg-[var(--surface-muted)]"
          >
            回到首页
          </a>
        </div>

        {error.digest ? (
          <p className="mt-3 select-all text-[11px] text-[var(--ink-soft)]">
            如果反复出现，把这个编号发给技术支持：
            <span className="ml-1 font-bold tabular-nums text-[var(--ink)]">{error.digest}</span>
          </p>
        ) : null}
      </div>
    </div>
  );
}
