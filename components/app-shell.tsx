import Link from "next/link";

import { logoutAction } from "@/app/actions";
import { BottomTabBar } from "@/components/bottom-tab-bar";
import { ContactButton } from "@/components/contact-button";
import { LanguageSwitcher } from "@/components/language-switcher";
import { MobileNav } from "@/components/mobile-nav";
import { getMessages, type Locale } from "@/lib/i18n";
import { APP_VERSION_LABEL } from "@/lib/version";

export function AppShell({
  locale,
  localePreference,
  currentUserName,
  currentUserEmail,
  children,
}: {
  locale: Locale;
  localePreference: Locale | "auto";
  /** Used by the floating ContactButton to prefill the From row of the
   *  feedback modal. AppShell already requires an authenticated session
   *  upstream, so these are always present. */
  currentUserName: string;
  currentUserEmail: string;
  children: React.ReactNode;
}) {
  const messages = getMessages(locale);

  // The i18n source-of-truth (`lib/i18n.ts`) uses `as const`, so every
  // `messages.shell.nav.*` value is typed as a string literal (e.g.
  // `"仪表盘"`, `"Dashboard"`). Without an explicit annotation here,
  // TypeScript would infer each group's `items` array as a heterogeneous
  // tuple of literal-typed objects, and `navGroups.flatMap(...)` further
  // down would fail to unify the four groups (the labels are different
  // literal types per group). Annotate as `NavItem`/`NavGroup` so the
  // labels widen to `string` and flatMap composes cleanly.
  type NavItem = { href: string; label: string };
  type NavGroup = { label: string; items: NavItem[] };

  const navGroups: NavGroup[] = [
    {
      label: messages.shell.nav.groupOperations,
      items: [
        { href: "/dashboard", label: messages.shell.nav.dashboard },
        { href: "/calendar", label: messages.shell.nav.calendar },
        { href: "/orders", label: messages.shell.nav.orders },
        { href: "/photos", label: messages.shell.nav.photos },
        { href: "/documents", label: messages.shell.nav.documents },
        { href: "/imports", label: messages.shell.nav.imports },
        { href: "/activity", label: messages.shell.nav.activity },
      ],
    },
    {
      label: messages.shell.nav.groupFleet,
      items: [
        { href: "/vehicles", label: messages.shell.nav.vehicles },
        { href: "/vehicle-roi", label: messages.shell.nav.vehicleRoi },
        { href: "/owners", label: messages.shell.nav.owners },
      ],
    },
    {
      label: messages.shell.nav.groupBookings,
      items: [
        { href: "/direct-booking", label: messages.shell.nav.directBooking },
      ],
    },
    {
      label: messages.shell.nav.groupBilling,
      items: [
        { href: "/billing", label: messages.shell.nav.billing },
        { href: "/payouts", label: messages.shell.nav.payouts },
      ],
    },
  ];

  // Items the BottomTabBar's "More" sheet should list. We intentionally
  // include the four primary destinations too — even though they're
  // already in the bar — so the More sheet works as a complete site
  // map and visitors who learn the app this way can find anything in
  // one place.
  const moreItems = navGroups.flatMap((group) => group.items);

  // The non-nav controls (language switcher, sign out, version chip)
  // need to live somewhere on mobile too. They get tucked into the
  // footer of the More sheet so the desktop sidebar's full surface is
  // reachable from a phone.
  const moreFooter = (
    <div className="space-y-3">
      <LanguageSwitcher
        locale={locale}
        preference={localePreference}
        label={messages.shell.languageLabel}
        hint={messages.shell.languageHint}
        autoLabel={messages.shell.languageAutoLabel}
      />
      <form action={logoutAction}>
        <button className="tap-press w-full rounded-full border border-[var(--line)] bg-white/72 px-3.5 py-2.5 text-[13px] font-medium text-[var(--ink-soft)] transition hover:border-[rgba(17,19,24,0.16)] hover:bg-white hover:text-[var(--ink)]">
          {messages.shell.signOut}
        </button>
      </form>
      <p className="text-center text-[11px] uppercase tracking-[0.24em] text-[var(--ink-soft)]/70">
        {messages.shell.versionLabel} · {APP_VERSION_LABEL}
      </p>
    </div>
  );

  // Desktop sidebar. v0.19.1 density pass: nav rows bumped from 13px
  // to 15px (matches the body line-height better and reads cleanly
  // on a 240px-wide column), padding tightened by ~1px each side so
  // the larger label still fits without word-breaking. Brand and
  // group-header copy slightly reduced so the navigation itself
  // becomes the dominant visual block.
  const sidebarContent = (
    <>
      <div className="space-y-1">
        <p className="text-[9px] uppercase tracking-[0.38em] text-[var(--ink-soft)]">
          {messages.shell.brandKicker}
        </p>
        <h1 className="font-serif text-[1.55rem] font-semibold leading-none text-[var(--ink)]">
          {messages.shell.brandTitle}
        </h1>
        <p className="max-w-[11.5rem] text-[11px] leading-4 text-[var(--ink-soft)]">
          {messages.shell.brandCopy}
        </p>
      </div>

      <nav className="mt-4 space-y-2.5">
        {navGroups.map((group) => (
          <div key={group.label} className="space-y-0.5">
            <p className="px-2.5 text-[9px] font-semibold uppercase tracking-[0.24em] text-[var(--ink-soft)]/75">
              {group.label}
            </p>
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="block rounded-full px-2.5 py-1.5 text-[13px] font-medium text-[var(--ink-soft)] transition hover:bg-white/85 hover:text-[var(--ink)] hover:shadow-[0_10px_30px_rgba(17,19,24,0.06)]"
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="mt-3">
        <LanguageSwitcher
          locale={locale}
          preference={localePreference}
          label={messages.shell.languageLabel}
          hint={messages.shell.languageHint}
          autoLabel={messages.shell.languageAutoLabel}
        />
      </div>

      <div className="mt-3 rounded-lg border border-[var(--line)] bg-white/80 px-3 py-2 text-[10px] text-[var(--ink-soft)] shadow-[0_14px_35px_rgba(17,19,24,0.05)]">
        <p className="font-medium text-[var(--ink)]">{messages.shell.versionLabel}</p>
        <p className="mt-0.5">{APP_VERSION_LABEL}</p>
      </div>

      <form action={logoutAction} className="mt-3">
        <button className="w-full rounded-full border border-[var(--line)] bg-white/72 px-3.5 py-2 text-[12px] font-medium text-[var(--ink-soft)] transition hover:border-[rgba(17,19,24,0.16)] hover:bg-white hover:text-[var(--ink)]">
          {messages.shell.signOut}
        </button>
      </form>
    </>
  );

  return (
    <div className="min-h-screen bg-[var(--page)] text-[var(--ink)]">
      <MobileNav
        brandTitle={messages.shell.brandTitle}
        brandKicker={messages.shell.brandKicker}
      />

      <div className="flex min-h-screen w-full">
        <aside className="hidden w-52 shrink-0 border-r border-[var(--line)] bg-[var(--panel-strong)] px-3 py-4 lg:block">
          {sidebarContent}
        </aside>

        {/* `min-w-0` is the load-bearing fix for mobile horizontal
         * overflow. Flex items default to `min-width: auto` (= the
         * child's `min-content` size). If any descendant of <main> has
         * a wide unbreakable token (long URLs, the sticky-header table
         * inside the calendar timeline, an overflow-x-auto strip's
         * inner flex, etc.), <main> grows past 100% and the page
         * scrolls horizontally. `min-w-0` overrides that to 0 so the
         * flex parent constrains <main> back to viewport width and
         * inner sections that NEED horizontal scroll (the metric
         * strip) keep doing it inside their own `overflow-x-auto`
         * container. */}
        <main className="min-w-0 flex-1 px-2.5 pb-[calc(env(safe-area-inset-bottom)+82px)] pt-3 sm:px-3 lg:px-3.5 lg:pb-4 lg:pt-3">
          {children}
        </main>
      </div>

      <BottomTabBar
        labels={messages.shell.bottomNav}
        moreItems={moreItems}
        moreFooter={moreFooter}
      />

      <ContactButton
        locale={locale}
        currentUserName={currentUserName}
        currentUserEmail={currentUserEmail}
      />
    </div>
  );
}
