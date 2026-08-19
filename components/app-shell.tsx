import {
  Banknote,
  CalendarDays,
  Car,
  CreditCard,
  FileSignature,
  FileText,
  History,
  Image,
  LayoutGrid,
  ListChecks,
  MessageCircle,
  Route,
  Settings,
  Sparkles,
  Ticket,
  TrendingUp,
  Upload,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { logoutAction } from "@/app/actions";
import { BottomTabBar } from "@/components/bottom-tab-bar";
import { ContactButton } from "@/components/contact-button";
import { LanguageSwitcher } from "@/components/language-switcher";
import { MobileNav } from "@/components/mobile-nav";
import { NavigationOptimizer } from "@/components/navigation-optimizer";
import { SessionExpiryRedirect } from "@/components/session-expiry-redirect";
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
  // Icons are components, not glyphs. The previous set was typographic
  // characters (◐ ✦ ▦ ◈), which render at whatever weight the font
  // decides, sit off the optical centre, and have no relationship to
  // what they label. Turo's console uses a line-icon set and the
  // operator switches between the two all day, so this matches it:
  // a chat bubble for messages, a car for vehicles, a bar chart for
  // the money pages.
  type NavItem = { href: string; label: string; icon: LucideIcon };
  type NavGroup = { label: string; items: NavItem[] };

  const navGroups: NavGroup[] = [
    {
      label: messages.shell.nav.groupOperations,
      items: [
        { href: "/dashboard", label: messages.shell.nav.dashboard, icon: LayoutGrid },
        { href: "/assistant", label: messages.shell.nav.assistant, icon: Sparkles },
        { href: "/messages", label: messages.shell.nav.guestMessages, icon: MessageCircle },
        { href: "/calendar", label: messages.shell.nav.calendar, icon: CalendarDays },
        { href: "/orders", label: messages.shell.nav.orders, icon: Route },
        { href: "/imports", label: messages.shell.nav.imports, icon: Upload },
      ],
    },
    {
      label: messages.shell.nav.groupFleet,
      items: [
        { href: "/vehicles", label: messages.shell.nav.vehicles, icon: Car },
        { href: "/vehicle-roi", label: messages.shell.nav.vehicleRoi, icon: TrendingUp },
        { href: "/owners", label: messages.shell.nav.owners, icon: UsersRound },
      ],
    },
    {
      label: messages.shell.nav.groupBookings,
      items: [
        { href: "/direct-booking", label: messages.shell.nav.directBooking, icon: Ticket },
      ],
    },
    {
      label: messages.shell.nav.groupTeam,
      items: [
        { href: "/staff-schedule", label: messages.shell.nav.staffSchedule, icon: ListChecks },
      ],
    },
    {
      label: messages.shell.nav.groupFiles,
      items: [
        { href: "/contracts", label: messages.shell.nav.contracts, icon: FileSignature },
        { href: "/photos", label: messages.shell.nav.photos, icon: Image },
        { href: "/documents", label: messages.shell.nav.documents, icon: FileText },
        { href: "/activity", label: messages.shell.nav.activity, icon: History },
      ],
    },
    {
      label: messages.shell.nav.groupBilling,
      items: [
        { href: "/billing", label: messages.shell.nav.billing, icon: CreditCard },
        { href: "/payouts", label: messages.shell.nav.payouts, icon: Banknote },
        { href: "/account-settings", label: messages.shell.nav.accountSettings, icon: Settings },
      ],
    },
  ];

  // Items the BottomTabBar's "More" sheet should list. We intentionally
  // include the four primary destinations too — even though they're
  // already in the bar — so the More sheet works as a complete site
  // map and visitors who learn the app this way can find anything in
  // one place.
  const moreItems = navGroups.flatMap((group) => group.items);
  const navHrefs = moreItems.map((item) => item.href);

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
        <button className="tap-press w-full rounded-md border border-[var(--line)] bg-white/72 px-3.5 py-2.5 text-[13px] font-medium text-[var(--ink-soft)] transition hover:border-[rgba(17,19,24,0.16)] hover:bg-white hover:text-[var(--ink)]">
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
      <div className="flex items-center gap-2.5 border-b border-[var(--line)] px-4 py-5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-[var(--ink)] text-sm font-semibold text-white">
          T
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-lg font-semibold leading-tight text-[var(--ink)]">
            {messages.shell.brandTitle}
          </div>
          <div className="truncate text-xs text-[var(--ink-soft)]">
            {messages.shell.brandCopy}
          </div>
        </div>
      </div>

      <SidebarNav groups={navGroups} />

      <div className="border-t border-[var(--line)] p-3 pb-16">
        <LanguageSwitcher
          locale={locale}
          preference={localePreference}
          label={messages.shell.languageLabel}
          hint={messages.shell.languageHint}
          autoLabel={messages.shell.languageAutoLabel}
        />
        <div
          className="mt-2 truncate text-xs text-[var(--ink-soft)]"
          title={currentUserEmail}
        >
          {currentUserName || currentUserEmail}
        </div>
        <form action={logoutAction} className="mt-2">
        <button className="text-xs text-[var(--ink-soft)] transition hover:text-[var(--ink)]">
          {messages.shell.signOut}
        </button>
        </form>
        <div className="pt-2 text-[10px] text-[var(--ink-soft)]">
          {APP_VERSION_LABEL}
        </div>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-[var(--surface-muted)] text-[var(--ink)]">
      <MobileNav
        brandTitle={messages.shell.brandTitle}
        brandKicker={messages.shell.brandKicker}
      />

      <div className="flex min-h-screen w-full">
        <aside className="fixed inset-y-0 left-0 z-40 hidden w-56 shrink-0 flex-col border-r border-[var(--line)] bg-white lg:flex">
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
      <NavigationOptimizer hrefs={navHrefs} />
      <SessionExpiryRedirect />
    </div>
  );
}
