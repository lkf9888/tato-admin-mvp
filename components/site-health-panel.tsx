import Link from "next/link";

import { getMessages, type Locale } from "@/lib/i18n";
import type { HealthCheck, HealthCheckKey, HealthStatus } from "@/lib/rental-site-health";

/** Where each item is fixed: an anchor on this page or another page. */
const FIX_HREF: Record<HealthCheckKey, string> = {
  published: "#site-address",
  bookable: "/direct-booking",
  unpriced: "/direct-booking?filter=live&sort=priceAsc",
  photos: "/direct-booking?filter=noPhotos",
  payouts: "/payouts",
  locations: "/direct-booking?tab=locations",
  domain: "#site-address",
  tracking: "#site-tracking",
  email: "/direct-booking?tab=email",
  translations: "#site-content",
  contact: "#site-contact",
  logo: "#site-brand",
};

const DOT: Record<HealthStatus, string> = {
  blocker: "bg-[color:var(--bad-fg)]",
  warn: "bg-[#d97706]",
  ok: "bg-[color:var(--ok-fg)]",
};

export function SiteHealthPanel({ locale, checks }: { locale: Locale; checks: HealthCheck[] }) {
  const copy = getMessages(locale).rentalSiteHealth;
  const blockers = checks.filter((check) => check.status === "blocker").length;
  const warnings = checks.filter((check) => check.status === "warn").length;
  const ready = checks.length - blockers - warnings;
  const pending = checks.filter((check) => check.status !== "ok");
  const done = checks.filter((check) => check.status === "ok");

  function describe(check: HealthCheck): string {
    switch (check.key) {
      case "published":
        return check.status === "ok" ? copy.published.ok : copy.published.bad;
      case "bookable":
        return check.status === "ok" ? copy.bookable.ok(check.count) : copy.bookable.bad;
      case "unpriced":
        return check.status === "ok" ? copy.unpriced.ok : copy.unpriced.bad(check.count);
      case "photos":
        return check.status === "ok" ? copy.photos.ok : copy.photos.bad(check.count);
      case "payouts":
        return check.state === "active" ? copy.payouts.ok : copy.payouts[check.state];
      case "locations":
        return check.status === "ok" ? copy.locations.ok(check.count) : copy.locations.bad;
      case "domain":
        return check.state === "none"
          ? copy.domain.none
          : copy.domain[check.state](check.domain ?? "");
      case "tracking":
        return check.status === "ok" ? copy.tracking.ok : copy.tracking.bad(check.analytics, check.ads);
      case "email":
        return copy.email[check.state];
      case "translations":
        return check.status === "ok" ? copy.translations.ok : copy.translations.bad(check.missing);
      case "contact":
        return check.status === "ok" ? copy.contact.ok : copy.contact.bad;
      case "logo":
        return check.status === "ok" ? copy.logo.ok : copy.logo.bad;
    }
  }

  return (
    <details
      open={blockers + warnings > 0}
      className="group rounded-lg border border-[color:var(--line)] bg-[rgba(255,255,255,0.88)] shadow-[0_20px_50px_-40px_rgba(17,19,24,0.4)]"
    >
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 [&::-webkit-details-marker]:hidden">
        <h3 className="text-[13px] font-semibold text-[color:var(--ink)]">{copy.title}</h3>
        <span className="text-[12px] tabular-nums text-[color:var(--ink-soft)]">
          {copy.summary(ready, checks.length)}
        </span>
        {blockers > 0 ? (
          <span className="rounded-full bg-[var(--bad-bg)] px-2 py-0.5 text-[11px] font-medium text-[color:var(--bad-fg)]">
            {copy.blockers(blockers)}
          </span>
        ) : null}
        {warnings > 0 ? (
          <span className="rounded-full bg-[#fef3c7] px-2 py-0.5 text-[11px] font-medium text-[#92400e]">
            {copy.warnings(warnings)}
          </span>
        ) : null}
        {blockers + warnings === 0 ? (
          <span className="rounded-full bg-[var(--ok-bg)] px-2 py-0.5 text-[11px] font-medium text-[color:var(--ok-fg)]">
            {copy.allClear}
          </span>
        ) : null}
        <span
          aria-hidden
          className="ml-auto text-[11px] text-[color:var(--ink-soft)] transition-transform group-open:rotate-180"
        >
          ▾
        </span>
      </summary>

      {pending.length > 0 ? (
        <ul className="divide-y divide-[color:var(--line)] border-t border-[color:var(--line)]">
          {pending.map((check) => (
            <li key={check.key} className="flex items-center gap-2.5 px-3 py-2">
              <span
                aria-label={check.status === "warn" ? copy.statusWarn : copy.statusBlocker}
                className={`h-2 w-2 shrink-0 rounded-full ${DOT[check.status]}`}
              />
              <p className="min-w-0 flex-1 text-[12px] leading-5 text-[color:var(--ink)]">
                {describe(check)}
              </p>
              <Link
                href={FIX_HREF[check.key]}
                className="shrink-0 rounded-md border border-[color:var(--line)] bg-[var(--surface)] px-2 py-1 text-[11px] font-medium text-[color:var(--ink)] hover:bg-[var(--surface-muted)]"
              >
                {copy.fix}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      {done.length > 0 ? (
        // What is already done matters less than what is not, so it
        // is one wrapped line rather than a row each.
        <ul className="flex flex-wrap gap-1.5 border-t border-[color:var(--line)] px-3 py-2.5">
          {done.map((check) => (
            <li
              key={check.key}
              className="flex items-center gap-1.5 rounded-full bg-[var(--surface-muted)] px-2 py-0.5 text-[11px] text-[color:var(--ink-soft)]"
            >
              <span aria-label={copy.statusOk} className={`h-1.5 w-1.5 rounded-full ${DOT.ok}`} />
              {describe(check)}
            </li>
          ))}
        </ul>
      ) : null}
    </details>
  );
}
