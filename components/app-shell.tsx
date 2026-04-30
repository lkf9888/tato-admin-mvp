import Link from "next/link";

import { logoutAction } from "@/app/actions";
import { LanguageSwitcher } from "@/components/language-switcher";
import { MobileNav } from "@/components/mobile-nav";
import { getMessages, type Locale } from "@/lib/i18n";
import { APP_VERSION_LABEL } from "@/lib/version";

export function AppShell({
  locale,
  localePreference,
  title,
  description,
  children,
}: {
  locale: Locale;
  localePreference: Locale | "auto";
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  const messages = getMessages(locale);
  const navGroups = [
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

  // Sidebar content is rendered into both the desktop aside and the mobile
  // drawer (via <MobileNav>) so the layout stays in one place.
  const sidebarContent = (
    <>
      <div className="space-y-2">
        <p className="text-[11px] uppercase tracking-[0.42em] text-[var(--ink-soft)]">
          {messages.shell.brandKicker}
        </p>
        <h1 className="font-serif text-[2.15rem] font-semibold leading-none text-[var(--ink)]">
          {messages.shell.brandTitle}
        </h1>
        <p className="max-w-[13rem] text-[12px] leading-5 text-[var(--ink-soft)]">
          {messages.shell.brandCopy}
        </p>
      </div>

      <nav className="mt-7 space-y-4">
        {navGroups.map((group) => (
          <div key={group.label} className="space-y-1">
            <p className="px-3 text-[10px] font-semibold uppercase tracking-[0.32em] text-[var(--ink-soft)]/70">
              {group.label}
            </p>
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="block rounded-full px-3.5 py-2 text-[13px] font-medium text-[var(--ink-soft)] transition hover:bg-white/85 hover:text-[var(--ink)] hover:shadow-[0_10px_30px_rgba(17,19,24,0.06)]"
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="mt-5">
        <LanguageSwitcher
          locale={locale}
          preference={localePreference}
          label={messages.shell.languageLabel}
          hint={messages.shell.languageHint}
          autoLabel={messages.shell.languageAutoLabel}
        />
      </div>

      <div className="mt-5 rounded-lg border border-[var(--line)] bg-white/80 px-4 py-3 text-[11px] text-[var(--ink-soft)] shadow-[0_14px_35px_rgba(17,19,24,0.05)]">
        <p className="font-medium text-[var(--ink)]">{messages.shell.versionLabel}</p>
        <p className="mt-1">{APP_VERSION_LABEL}</p>
      </div>

      <form action={logoutAction} className="mt-6">
        <button className="w-full rounded-full border border-[var(--line)] bg-white/72 px-4 py-3 text-[13px] font-medium text-[var(--ink-soft)] transition hover:border-[rgba(17,19,24,0.16)] hover:bg-white hover:text-[var(--ink)]">
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
      >
        {sidebarContent}
      </MobileNav>

      <div className="flex min-h-screen w-full">
        <aside className="hidden w-60 shrink-0 border-r border-[var(--line)] bg-[var(--panel-strong)] px-5 py-6 lg:block">
          {sidebarContent}
        </aside>

        <main className="flex-1 px-3 py-4 sm:px-4 lg:px-6">
          <header className="mb-5 flex flex-col gap-3 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-4 py-4 shadow-[0_24px_70px_rgba(17,19,24,0.06)] backdrop-blur sm:px-5 sm:py-5 md:flex-row md:items-end md:justify-between md:gap-4">
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.34em] text-[var(--ink-soft)] sm:text-[11px]">
                {messages.shell.workspaceKicker}
              </p>
              <h2 className="mt-2 font-serif text-[1.7rem] font-semibold leading-tight text-[var(--ink)] sm:text-[2.05rem] sm:leading-none md:text-[2.35rem]">
                {title}
              </h2>
              <p className="mt-2 max-w-2xl text-[12px] leading-5 text-[var(--ink-soft)] sm:text-[13px]">
                {description}
              </p>
            </div>
            <div className="self-start whitespace-normal break-words rounded-full border border-[rgba(89,60,251,0.12)] bg-[var(--accent-soft)] px-3 py-1.5 text-[10px] leading-tight text-[var(--ink)] shadow-[0_10px_20px_rgba(89,60,251,0.08)] sm:self-auto sm:px-3.5 sm:py-2 sm:text-[11px]">
              {messages.shell.workspaceBadge}
            </div>
          </header>
          {children}
        </main>
      </div>
    </div>
  );
}
