import Link from "next/link";

/**
 * The frame both direct-booking pages share: the summary header and the
 * row of tabs. The first four tabs live on /direct-booking and switch in
 * place; the rental website is its own page (/direct-booking/site), so
 * on that page every tab is a link. One set of classes keeps the two
 * rows looking like the same control.
 */

export const TAB_BAR_CLASS =
  "flex gap-1 overflow-x-auto rounded-lg border border-[color:var(--line)] bg-[rgba(255,255,255,0.88)] p-1 shadow-[0_20px_50px_-40px_rgba(17,19,24,0.4)]";

export function tabClass(selected: boolean) {
  return `flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors ${
    selected
      ? "bg-[var(--ink)] text-white"
      : "text-[color:var(--ink-soft)] hover:bg-[var(--surface-muted)] hover:text-[color:var(--ink)]"
  }`;
}

export function tabBadgeClass(selected: boolean) {
  return `rounded-full px-1.5 text-[10px] tabular-nums ${
    selected ? "bg-white/20 text-white" : "bg-[var(--surface-muted)] text-[color:var(--ink-soft)]"
  }`;
}

export type DirectBookingSection =
  | "vehicles"
  | "rules"
  | "locations"
  | "email"
  | "agreement"
  | "requests"
  | "deposits"
  | "ads"
  | "site";

export function directBookingSectionHref(section: DirectBookingSection) {
  if (section === "vehicles") return "/direct-booking";
  if (section === "site") return "/direct-booking/site";
  if (section === "requests") return "/direct-booking/requests";
  if (section === "deposits") return "/direct-booking/deposits";
  if (section === "ads") return "/direct-booking/ads";
  return `/direct-booking?tab=${section}`;
}

/**
 * The top of every direct-booking page: no hero card (the tabs say
 * where you are), a page name for screen readers, and one line only
 * when something needs doing -- renters cannot pay while Stripe is not
 * connected.
 */
export function DirectBookingHeader({
  pageName,
  stripeReady,
  stripeMissingLabel,
}: {
  pageName: string;
  stripeReady: boolean;
  stripeMissingLabel: string;
}) {
  return (
    <>
      <h1 className="sr-only">{pageName}</h1>
      {!stripeReady ? (
        <Link
          href="/payouts"
          className="block rounded-md border border-[color:var(--bad-fg)]/25 bg-[var(--bad-bg)] px-3 py-2 text-[12px] font-medium text-[color:var(--bad-fg)]"
        >
          {stripeMissingLabel} →
        </Link>
      ) : null}
    </>
  );
}

/** The tab row as plain links, for the page that is not /direct-booking. */
export function DirectBookingLinkTabs({
  label,
  active,
  items,
}: {
  label: string;
  active: DirectBookingSection;
  items: Array<{ key: DirectBookingSection; label: string; badge?: string | number | null }>;
}) {
  return (
    <nav aria-label={label} className={TAB_BAR_CLASS}>
      {items.map((item) => {
        const selected = item.key === active;
        return (
          <Link
            key={item.key}
            href={directBookingSectionHref(item.key)}
            aria-current={selected ? "page" : undefined}
            className={tabClass(selected)}
          >
            {item.label}
            {item.badge != null && item.badge !== "" ? (
              <span className={tabBadgeClass(selected)}>{item.badge}</span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
