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
  title,
  description,
  currentUserName,
  currentUserEmail,
  children,
}: {
  locale: Locale;
  localePreference: Locale | "auto";
  title: string;
  description: string;
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
        { href: "/imports", label: messages.shell.nav.imports },
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
        { href: "/share-links", label: messages.shell.nav.shareLinks },
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
    <div className="space-y-4">
      <LanguageSwitcher
        locale={locale}
        preference={localePreference}
        label={messages.shell.languageLabel}
        hint={messages.shell.languageHint}
        autoLabel={messages.shell.languageAutoLabel}
      />
      <form action={logoutAction}>
        <button className="tap-press w-full rounded-full border border-[var(--line)] bg-white/72 px-4 py-3 text-[14px] font-medium text-[var(--ink-soft)] transition hover:border-[rgba(17,19,24,0.16)] hover:bg-white hover:text-[var(--ink)]">
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
      <div className="space-y-1.5">
        <p className="text-[10px] uppercase tracking-[0.42em] text-[var(--ink-soft)]">
          {messages.shell.brandKicker}
        </p>
        <h1 className="font-serif text-[1.85rem] font-semibold leading-none text-[var(--ink)]">
          {messages.shell.brandTitle}
        </h1>
        <p className="max-w-[13rem] text-[12px] leading-5 text-[var(--ink-soft)]">
          {messages.shell.brandCopy}
        </p>
      </div>

      <nav className="mt-5 space-y-3.5">
        {navGroups.map((group) => (
          <div key={group.label} className="space-y-1">
            <p className="px-3 text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--ink-soft)]/75">
              {group.label}
            </p>
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="block rounded-full px-3 py-2 text-[15px] font-medium text-[var(--ink-soft)] transition hover:bg-white/85 hover:text-[var(--ink)] hover:shadow-[0_10px_30px_rgba(17,19,24,0.06)]"
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="mt-4">
        <LanguageSwitcher
          locale={locale}
          preference={localePreference}
          label={messages.shell.languageLabel}
          hint={messages.shell.languageHint}
          autoLabel={messages.shell.languageAutoLabel}
        />
      </div>

      <div className="mt-4 rounded-lg border border-[var(--line)] bg-white/80 px-3.5 py-2.5 text-[11px] text-[var(--ink-soft)] shadow-[0_14px_35px_rgba(17,19,24,0.05)]">
        <p className="font-medium text-[var(--ink)]">{messages.shell.versionLabel}</p>
        <p className="mt-0.5">{APP_VERSION_LABEL}</p>
      </div>

      <form action={logoutAction} className="mt-4">
        <button className="w-full rounded-full border border-[var(--line)] bg-white/72 px-4 py-2.5 text-[13px] font-medium text-[var(--ink-soft)] transition hover:border-[rgba(17,19,24,0.16)] hover:bg-white hover:text-[var(--ink)]">
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
        <aside className="hidden w-60 shrink-0 border-r border-[var(--line)] bg-[var(--panel-strong)] px-4 py-5 lg:block">
          {sidebarContent}
        </aside>

        <main className="flex-1 px-3 pb-[calc(env(safe-area-inset-bottom)+88px)] pt-4 sm:px-4 lg:px-5 lg:pb-5 lg:pt-3.5">
          {/* v0.19.1 density pass: page-header card was eating ~120px
           * of vertical space on desktop with title at 2.35rem and
           * 20px-each-side padding. Title shrunk to 1.55rem on
           * desktop, padding to 14×14, gap to 2px between rows,
           * description text held at 12-13px. The workspace badge
           * also dropped one tier. End result: ~70px header on
           * desktop, ~50% denser, no info lost. */}
          {/* v0.19.4 mobile: titles were dominating the screen and the
           * tech-info badge ("Turo MVP · SQLite + …") was forcing
           * page-level horizontal overflow because `self-start` on a
           * `flex-col` lets the child grow to natural content width
           * uncapped. Two fixes: (1) badge gets `max-w-full` so it
           * wraps at the viewport boundary instead of pushing the
           * page wider; (2) page title and kicker shrink one tier on
           * mobile so they read as a header, not a hero. */}
          <header className="mb-3 flex flex-col gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-4 py-3 shadow-[0_24px_70px_rgba(17,19,24,0.06)] backdrop-blur sm:gap-2 sm:px-4 sm:py-3.5 md:flex-row md:items-center md:justify-between md:gap-4">
            <div className="min-w-0">
              <p className="text-[9px] uppercase tracking-[0.24em] text-[var(--ink-soft)] sm:text-[10px] sm:tracking-[0.32em]">
                {messages.shell.workspaceKicker}
              </p>
              <h2 className="mt-0.5 font-serif text-[1.05rem] font-semibold leading-tight text-[var(--ink)] sm:mt-1 sm:text-[1.5rem] md:text-[1.6rem]">
                {title}
              </h2>
              <p className="mt-1 max-w-3xl break-words text-[11.5px] leading-snug text-[var(--ink-soft)] sm:text-[12.5px]">
                {description}
              </p>
            </div>
            {/* Tech metadata pill. Hidden on phones to save vertical
             * space and prevent overflow — the info is preserved in
             * the More-sheet footer + sidebar on larger screens, where
             * there's actually room for it. */}
            <div className="hidden max-w-full self-start break-words rounded-full border border-[rgba(89,60,251,0.12)] bg-[var(--accent-soft)] px-3 py-1 text-[10px] leading-tight text-[var(--ink)] shadow-[0_10px_20px_rgba(89,60,251,0.08)] sm:inline-flex sm:max-w-none sm:self-auto md:text-[11px]">
              {messages.shell.workspaceBadge}
            </div>
          </header>
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
