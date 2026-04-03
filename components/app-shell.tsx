import Link from "next/link";

import { logoutAction } from "@/app/actions";
import { LanguageSwitcher } from "@/components/language-switcher";
import { getMessages, type Locale } from "@/lib/i18n";

export function AppShell({
  locale,
  title,
  description,
  children,
}: {
  locale: Locale;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  const messages = getMessages(locale);
  const navItems = [
    { href: "/dashboard", label: messages.shell.nav.dashboard },
    { href: "/vehicles", label: messages.shell.nav.vehicles },
    { href: "/owners", label: messages.shell.nav.owners },
    { href: "/orders", label: messages.shell.nav.orders },
    { href: "/calendar", label: messages.shell.nav.calendar },
    { href: "/imports", label: messages.shell.nav.imports },
    { href: "/share-links", label: messages.shell.nav.shareLinks },
  ];

  return (
    <div className="min-h-screen bg-[var(--page)] text-slate-950">
      <div className="flex min-h-screen w-full">
        <aside className="hidden w-48 shrink-0 border-r border-white/70 bg-[var(--panel-strong)] px-3 py-4 lg:block">
          <div className="space-y-1.5">
            <p className="text-[11px] uppercase tracking-[0.32em] text-slate-500">
              {messages.shell.brandKicker}
            </p>
            <h1 className="font-serif text-xl font-semibold text-slate-900">
              {messages.shell.brandTitle}
            </h1>
            <p className="max-w-[11rem] text-[11px] leading-4 text-slate-600">
              {messages.shell.brandCopy}
            </p>
          </div>

          <nav className="mt-5 space-y-1">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="block rounded-xl px-2.5 py-2 text-[13px] font-medium text-slate-700 transition hover:bg-white hover:text-slate-950"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="mt-5">
            <LanguageSwitcher
              locale={locale}
              label={messages.shell.languageLabel}
              hint={messages.shell.languageHint}
            />
          </div>

          <form action={logoutAction} className="mt-5">
            <button className="w-full rounded-xl border border-slate-300 px-3 py-2 text-[13px] font-medium text-slate-700 transition hover:border-slate-900 hover:text-slate-950">
              {messages.shell.signOut}
            </button>
          </form>
        </aside>

        <main className="flex-1 px-2.5 py-3 sm:px-3 lg:px-4">
          <header className="mb-4 flex flex-col gap-2.5 rounded-2xl border border-white/70 bg-white/85 px-4 py-3 shadow-sm backdrop-blur md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-[0.28em] text-slate-500">
                {messages.shell.workspaceKicker}
              </p>
              <h2 className="mt-1 font-serif text-2xl font-semibold text-slate-950">{title}</h2>
              <p className="mt-1 max-w-xl text-[13px] leading-5 text-slate-600">{description}</p>
            </div>
            <div className="rounded-xl bg-[var(--accent-soft)] px-3 py-1.5 text-[11px] text-slate-700">
              {messages.shell.workspaceBadge}
            </div>
          </header>
          {children}
        </main>
      </div>
    </div>
  );
}
