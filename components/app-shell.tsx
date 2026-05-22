import { logoutAction } from "@/app/actions";
import { BottomTabBar } from "@/components/bottom-tab-bar";
import { ContactButton } from "@/components/contact-button";
import { LanguageSwitcher } from "@/components/language-switcher";
import { MobileNav } from "@/components/mobile-nav";
import { SidebarNav } from "@/components/sidebar-nav";
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
  type NavItem = { href: string; label: string; icon: string };
  type NavGroup = { label: string; items: NavItem[] };

  const navGroups: NavGroup[] = [
    {
      label: messages.shell.nav.groupOperations,
      items: [
        { href: "/dashboard", label: messages.shell.nav.dashboard, icon: "◐" },
        { href: "/calendar", label: messages.shell.nav.calendar, icon: "▦" },
        { href: "/orders", label: messages.shell.nav.orders, icon: "◈" },
        { href: "/imports", label: messages.shell.nav.imports, icon: "⇧" },
      ],
    },
    {
      label: messages.shell.nav.groupFleet,
      items: [
        { href: "/vehicles", label: messages.shell.nav.vehicles, icon: "▣" },
        { href: "/vehicle-roi", label: messages.shell.nav.vehicleRoi, icon: "◇" },
        { href: "/owners", label: messages.shell.nav.owners, icon: "♔" },
      ],
    },
    {
      label: messages.shell.nav.groupBookings,
      items: [
        { href: "/direct-booking", label: messages.shell.nav.directBooking, icon: "◎" },
      ],
    },
    {
      label: messages.shell.nav.groupTeam,
      items: [
        { href: "/staff-schedule", label: messages.shell.nav.staffSchedule, icon: "☷" },
      ],
    },
    {
      label: messages.shell.nav.groupFiles,
      items: [
        { href: "/photos", label: messages.shell.nav.photos, icon: "▤" },
        { href: "/documents", label: messages.shell.nav.documents, icon: "▥" },
        { href: "/activity", label: messages.shell.nav.activity, icon: "♺" },
      ],
    },
    {
      label: messages.shell.nav.groupBilling,
      items: [
        { href: "/billing", label: messages.shell.nav.billing, icon: "$" },
        { href: "/payouts", label: messages.shell.nav.payouts, icon: "↗" },
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

  const sidebarContent = (
    <>
      <div className="flex items-center gap-2.5 border-b border-neutral-200 px-4 py-5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-neutral-900 text-sm font-semibold text-white">
          T
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-lg font-semibold leading-tight text-neutral-950">
            {messages.shell.brandTitle}
          </div>
          <div className="truncate text-xs text-neutral-500">
            {messages.shell.brandCopy}
          </div>
        </div>
      </div>

      <SidebarNav groups={navGroups} />

      <div className="border-t border-neutral-200 p-3">
        <LanguageSwitcher
          locale={locale}
          preference={localePreference}
          label={messages.shell.languageLabel}
          hint={messages.shell.languageHint}
          autoLabel={messages.shell.languageAutoLabel}
        />
        <div
          className="mt-2 truncate text-xs text-neutral-500"
          title={currentUserEmail}
        >
          {currentUserName || currentUserEmail}
        </div>
        <form action={logoutAction} className="mt-2">
        <button className="text-xs text-neutral-500 transition hover:text-neutral-950">
          {messages.shell.signOut}
        </button>
        </form>
        <div className="pt-2 text-[10px] text-neutral-400">
          {APP_VERSION_LABEL}
        </div>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-950">
      <MobileNav
        brandTitle={messages.shell.brandTitle}
        brandKicker={messages.shell.brandKicker}
      />

      <div className="flex min-h-screen w-full">
        <aside className="fixed inset-y-0 left-0 z-40 hidden w-56 shrink-0 flex-col border-r border-neutral-200 bg-white lg:flex">
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
        <main className="min-w-0 flex-1 px-2.5 pb-[calc(env(safe-area-inset-bottom)+82px)] pt-3 sm:px-3 lg:ml-56 lg:px-4 lg:pb-4 lg:pt-4">
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
