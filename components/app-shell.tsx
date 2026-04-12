import Link from "next/link";

import { logoutAction } from "@/app/actions";
import { LanguageSwitcher } from "@/components/language-switcher";
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
  const navItems = [
    { href: "/dashboard", label: messages.shell.nav.dashboard },
    { href: "/vehicles", label: messages.shell.nav.vehicles },
    { href: "/vehicle-roi", label: messages.shell.nav.vehicleRoi },
    { href: "/owners", label: messages.shell.nav.owners },
    { href: "/orders", label: messages.shell.nav.orders },
    { href: "/calendar", label: messages.shell.nav.calendar },
    { href: "/imports", label: messages.shell.nav.imports },
    { href: "/billing", label: messages.shell.nav.billing },
    { href: "/share-links", label: messages.shell.nav.shareLinks },
  ];

  return (
    <div className="min-h-screen bg-[var(--page)] text-[var(--ink)]">
      <div className="flex min-h-screen w-full">
        <aside className="hidden w-60 shrink-0 border-r border-[var(--line)] bg-[var(--panel-strong)] px-5 py-6 lg:block">
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

          <nav className="mt-8 space-y-1.5">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="block rounded-full px-3.5 py-2.5 text-[13px] font-medium text-[var(--ink-soft)] transition hover:bg-white/85 hover:text-[var(--ink)] hover:shadow-[0_10px_30px_rgba(17,19,24,0.06)]"
              >
                {item.label}
              </Link>
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

          <div className="mt-5 rounded-[1.4rem] border border-[var(--line)] bg-white/80 px-4 py-3 text-[11px] text-[var(--ink-soft)] shadow-[0_14px_35px_rgba(17,19,24,0.05)]">
            <p className="font-medium text-[var(--ink)]">{messages.shell.versionLabel}</p>
            <p className="mt-1">{APP_VERSION_LABEL}</p>
          </div>

          <form action={logoutAction} className="mt-6">
            <button className="w-full rounded-full border border-[var(--line)] bg-white/72 px-4 py-3 text-[13px] font-medium text-[var(--ink-soft)] transition hover:border-[rgba(17,19,24,0.16)] hover:bg-white hover:text-[var(--ink)]">
              {messages.shell.signOut}
            </button>
          </form>
        </aside>

        <main className="flex-1 px-3 py-4 sm:px-4 lg:px-6">
          <header className="mb-5 flex flex-col gap-4 rounded-[2rem] border border-[var(--line)] bg-[var(--surface)] px-5 py-5 shadow-[0_24px_70px_rgba(17,19,24,0.06)] backdrop-blur md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-[0.34em] text-[var(--ink-soft)]">
                {messages.shell.workspaceKicker}
              </p>
              <h2 className="mt-2 font-serif text-[2.35rem] font-semibold leading-none text-[var(--ink)]">
                {title}
              </h2>
              <p className="mt-2 max-w-2xl text-[13px] leading-5 text-[var(--ink-soft)]">{description}</p>
            </div>
            <div className="rounded-full border border-[rgba(255,107,87,0.12)] bg-[var(--accent-soft)] px-3.5 py-2 text-[11px] text-[var(--ink)] shadow-[0_10px_20px_rgba(255,107,87,0.08)]">
              {messages.shell.workspaceBadge}
            </div>
          </header>
          {children}
        </main>
      </div>
    </div>
  );
}
