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

export type DirectBookingSection = "vehicles" | "rules" | "locations" | "email" | "site";

export function directBookingSectionHref(section: DirectBookingSection) {
  if (section === "vehicles") return "/direct-booking";
  if (section === "site") return "/direct-booking/site";
  return `/direct-booking?tab=${section}`;
}

export type DirectBookingStat = { label: string; value: string | number; tone?: "ok" | "bad" };

export function buildDirectBookingStats(
  copy: {
    enabledCount: string;
    readyCount: string;
    stripeStatus: string;
    stripeReady: string;
    stripeMissing: string;
  },
  summary: { enabledCount: number; readyCount: number; stripeReady: boolean },
): DirectBookingStat[] {
  return [
    { label: copy.enabledCount, value: summary.enabledCount },
    { label: copy.readyCount, value: summary.readyCount },
    {
      label: copy.stripeStatus,
      value: summary.stripeReady ? copy.stripeReady : copy.stripeMissing,
      tone: summary.stripeReady ? "ok" : "bad",
    },
  ];
}

export function DirectBookingHeader({
  kicker,
  title,
  stats,
}: {
  kicker: string;
  title: string;
  stats: DirectBookingStat[];
}) {
  return (
    <section className="rounded-lg border border-[color:var(--line)] bg-[linear-gradient(140deg,rgba(255,255,255,0.94),rgba(255,240,231,0.97))] px-3 py-2.5 shadow-[0_20px_48px_-40px_rgba(17,19,24,0.45)] sm:px-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.24em] text-[color:var(--ink-soft)]">{kicker}</p>
          <h2 className="mt-0.5 font-serif text-[1.15rem] leading-tight text-[color:var(--ink)] sm:text-[1.25rem]">
            {title}
          </h2>
        </div>
        <dl className="flex flex-wrap gap-1.5">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="flex items-baseline gap-1.5 rounded-full border border-[rgba(17,19,24,0.08)] bg-white/80 px-3 py-1 text-[11px]"
            >
              <dt className="text-[color:var(--ink-soft)]">{stat.label}</dt>
              <dd
                className={`font-semibold tabular-nums ${
                  stat.tone === "ok"
                    ? "text-[color:var(--ok-fg)]"
                    : stat.tone === "bad"
                      ? "text-[color:var(--bad-fg)]"
                      : "text-[color:var(--ink)]"
                }`}
              >
                {stat.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
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
