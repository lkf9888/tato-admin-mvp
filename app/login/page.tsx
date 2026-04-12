import { redirect } from "next/navigation";

import { loginAction } from "@/app/actions";
import { isAdminAuthenticated } from "@/lib/auth";
import { getMessages } from "@/lib/i18n";
import { APP_VERSION_LABEL } from "@/lib/version";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const authenticated = await isAdminAuthenticated();
  if (authenticated) redirect("/dashboard");

  const [params, messages] = await Promise.all([searchParams, Promise.resolve(getMessages("en"))]);
  const loginMessages = messages.login;

  return (
    <main className="min-h-screen bg-[var(--page)] px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto grid min-h-[calc(100vh-3rem)] max-w-[86rem] overflow-hidden rounded-[2.5rem] border border-[var(--line)] bg-[rgba(255,250,244,0.9)] shadow-[0_30px_90px_rgba(17,19,24,0.08)] lg:grid-cols-[1.18fr_0.82fr]">
        <section className="relative hidden overflow-hidden bg-[#111318] px-12 py-12 text-white lg:block">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_18%,rgba(255,127,102,0.22),transparent_28%),radial-gradient(circle_at_88%_12%,rgba(53,110,88,0.28),transparent_30%),linear-gradient(180deg,#171a20_0%,#12141a_58%,#090b12_100%)]" />
          <div className="absolute inset-y-0 right-0 w-px bg-white/8" />
          <div className="relative flex h-full flex-col justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-[0.42em] text-white/58">
                {loginMessages.heroKicker}
              </p>
              <h1 className="mt-4 font-serif text-[5.4rem] leading-none tracking-[-0.08em]">
                {loginMessages.brandName}
              </h1>
              <p className="mt-4 max-w-sm text-[13px] leading-6 text-white/68">
                {loginMessages.brandIntro}
              </p>
              <h2 className="mt-12 max-w-2xl font-serif text-[3.2rem] leading-[1.02] tracking-[-0.05em] text-white">
                {loginMessages.heroTitle}
              </h2>
              <p className="mt-5 max-w-lg text-[14px] leading-7 text-white/72">
                {loginMessages.heroCopy}
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              {loginMessages.features.map(([label, copy]) => (
                <div key={label} className="rounded-[1.6rem] border border-white/10 bg-white/[0.04] p-5 backdrop-blur">
                  <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-white/94">{label}</p>
                  <p className="mt-3 text-[13px] leading-6 text-white/60">{copy}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="flex items-center bg-[rgba(255,252,247,0.68)] px-6 py-10 sm:px-10 lg:px-14">
          <div className="mx-auto w-full max-w-md">
            <div className="rounded-[2rem] border border-[var(--line)] bg-white/78 px-7 py-7 shadow-[0_26px_65px_rgba(17,19,24,0.06)] backdrop-blur">
              <p className="text-[11px] uppercase tracking-[0.35em] text-[var(--ink-soft)]">{loginMessages.kicker}</p>
              <h2 className="mt-3 font-serif text-[2.85rem] leading-none text-[var(--ink)]">{loginMessages.title}</h2>
              <p className="mt-3 text-[13px] leading-6 text-[var(--ink-soft)]">{loginMessages.description}</p>

              <form action={loginAction} className="mt-8 space-y-4">
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-[var(--ink)]">
                    {loginMessages.emailLabel}
                  </span>
                  <input
                    name="email"
                    type="email"
                    className="w-full rounded-full border border-[var(--line)] bg-[var(--surface-muted)] px-4 py-3.5 text-[14px] outline-none placeholder:text-slate-400"
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-[var(--ink)]">
                    {loginMessages.passwordLabel}
                  </span>
                  <input
                    name="password"
                    type="password"
                    className="w-full rounded-full border border-[var(--line)] bg-[var(--surface-muted)] px-4 py-3.5 text-[14px] outline-none placeholder:text-slate-400"
                  />
                </label>

                {params.error ? (
                  <p className="rounded-[1.25rem] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                    {loginMessages.invalidCredentials}
                  </p>
                ) : null}

                <button className="w-full rounded-full bg-[var(--ink)] px-4 py-3.5 font-medium text-white shadow-[0_16px_34px_rgba(17,19,24,0.16)] transition hover:translate-y-[-1px] hover:bg-[#1a1d24]">
                  {loginMessages.submit}
                </button>
              </form>

              <div className="mt-6 rounded-[1.6rem] border border-[var(--line)] bg-[var(--surface-muted)] px-5 py-4 text-sm text-[var(--ink-soft)]">
                <p className="font-medium text-[var(--ink)]">{loginMessages.registerPrompt}</p>
                <a href="/register" className="mt-2 inline-flex text-sm font-medium text-[var(--ink)] underline underline-offset-4 decoration-[var(--accent)]">
                  {loginMessages.registerLink}
                </a>
              </div>

              <p className="mt-5 text-[11px] uppercase tracking-[0.24em] text-slate-400">
                {loginMessages.versionLabel} {APP_VERSION_LABEL}
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
