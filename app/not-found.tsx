import Link from "next/link";

import { ERROR_COPY } from "@/lib/error-copy";
import { getLocale } from "@/lib/i18n-server";

/**
 * 404.
 *
 * Worth a real page rather than Next's default, because the most
 * common way to land here is a link inside this app that points
 * somewhere that no longer exists -- /orders/<id> was exactly that for
 * two versions. Telling the operator which address failed lets them
 * say something useful about it.
 */
export default async function NotFound() {
  const t = ERROR_COPY[await getLocale()];
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="w-full max-w-md rounded-lg border border-[var(--line)] bg-[var(--surface)] px-4 py-5 text-center">
        <p className="t-eyebrow text-[var(--ink-soft)]">404</p>
        <h1 className="t-title mt-1.5 text-[var(--ink)]">{t.notFoundTitle}</h1>
        <p className="mt-1.5 text-[12.5px] leading-5 text-[var(--ink-soft)]">
          {t.notFoundBody}
        </p>
        <Link
          href="/dashboard"
          className="tap-press mt-4 inline-flex items-center justify-center rounded-md bg-[var(--ink)] px-4 py-2 text-[12.5px] font-bold text-white transition hover:opacity-90"
        >
          {t.home}
        </Link>
      </div>
    </div>
  );
}
