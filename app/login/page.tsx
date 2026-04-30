import { redirect } from "next/navigation";

import { loginAction } from "@/app/actions";
import { CompactLanguageSwitcher } from "@/components/language-switcher";
import { isAdminAuthenticated } from "@/lib/auth";
import { getI18n } from "@/lib/i18n-server";
import { APP_VERSION_LABEL } from "@/lib/version";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; retryAfter?: string }>;
}) {
  const authenticated = await isAdminAuthenticated();
  if (authenticated) redirect("/dashboard");

  const [params, { locale, messages }] = await Promise.all([searchParams, getI18n()]);
  const loginMessages = messages.login;

  return (
    <main className="min-h-screen bg-white text-black">
      <div className="mx-auto flex min-h-screen max-w-[86rem] flex-col lg:grid lg:grid-cols-[1.18fr_0.82fr] lg:overflow-hidden">
        {/* Hero column — pure black, hidden on small screens */}
        <section className="relative hidden overflow-hidden bg-black px-8 py-10 text-white lg:block lg:px-12 lg:py-14">
          <div className="relative flex h-full flex-col justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-[0.42em] text-white/60">
                {loginMessages.heroKicker}
              </p>
              <h1 className="mt-4 font-serif text-[5rem] leading-none tracking-[-0.08em] xl:text-[5.4rem]">
                {loginMessages.brandName}
              </h1>
              <p className="mt-4 max-w-sm text-[13px] leading-6 text-white/70">
                {loginMessages.brandIntro}
              </p>
              <h2 className="mt-12 max-w-2xl font-serif text-[2.6rem] leading-[1.02] tracking-[-0.04em] text-white xl:text-[3.2rem] xl:tracking-[-0.05em]">
                {loginMessages.heroTitle}
              </h2>
              <p className="mt-5 max-w-lg text-[14px] leading-7 text-white/70">
                {loginMessages.heroCopy}
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              {loginMessages.features.map(([label, copy]) => (
                <div
                  key={label}
                  className="rounded-lg border border-white/15 bg-white/[0.04] p-5"
                >
                  <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-white">
                    {label}
                  </p>
                  <p className="mt-3 text-[13px] leading-6 text-white/60">{copy}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Form column */}
        <section className="relative flex flex-1 items-start justify-center bg-white px-4 pb-10 pt-6 sm:px-8 sm:pt-10 lg:items-center lg:px-12 lg:py-10">
          {/* Top bar with mobile branding and language switcher */}
          <div className="absolute inset-x-0 top-0 flex items-center justify-between px-4 pt-5 sm:px-8 lg:left-auto lg:right-6 lg:top-6 lg:justify-end">
            <p className="font-serif text-2xl font-semibold tracking-tight text-black lg:hidden">
              {loginMessages.brandName}
            </p>
            <CompactLanguageSwitcher locale={locale} />
          </div>

          <div className="mt-12 w-full max-w-md sm:mt-16 lg:mt-0">
            <div className="rounded-lg border border-black/10 bg-white px-5 py-7 shadow-[0_24px_60px_rgba(0,0,0,0.06)] sm:px-7 sm:py-8">
              <p className="text-[11px] uppercase tracking-[0.35em] text-black/55">
                {loginMessages.kicker}
              </p>
              <h2 className="mt-3 font-serif text-[2.2rem] leading-none text-black sm:text-[2.6rem]">
                {loginMessages.title}
              </h2>
              <p className="mt-3 text-[13px] leading-6 text-black/60">
                {loginMessages.description}
              </p>

              <form action={loginAction} className="mt-7 space-y-4">
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-black">
                    {loginMessages.emailLabel}
                  </span>
                  <input
                    name="email"
                    type="email"
                    className="w-full rounded-full border border-black/15 bg-white px-4 py-3.5 text-[14px] text-black outline-none transition focus:border-black placeholder:text-black/40"
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-black">
                    {loginMessages.passwordLabel}
                  </span>
                  <input
                    name="password"
                    type="password"
                    className="w-full rounded-full border border-black/15 bg-white px-4 py-3.5 text-[14px] text-black outline-none transition focus:border-black placeholder:text-black/40"
                  />
                </label>

                {params.error === "throttled" ? (
                  <p className="rounded-md border border-black bg-black/5 px-4 py-3 text-sm text-black">
                    {loginMessages.throttled}
                  </p>
                ) : params.error ? (
                  <p className="rounded-md border border-black bg-black/5 px-4 py-3 text-sm text-black">
                    {loginMessages.invalidCredentials}
                  </p>
                ) : null}

                <button className="w-full rounded-full bg-black px-4 py-3.5 font-medium text-white shadow-[0_16px_34px_rgba(0,0,0,0.18)] transition hover:translate-y-[-1px] hover:bg-black/90">
                  {loginMessages.submit}
                </button>
              </form>

              <div className="mt-5">
                <a
                  href="/forgot-password"
                  className="text-sm font-medium text-black/70 underline underline-offset-4 decoration-black/30 hover:text-black hover:decoration-black"
                >
                  {loginMessages.forgotPassword}
                </a>
              </div>

              <div className="mt-6 rounded-lg border border-black/10 bg-black/[0.025] px-5 py-4 text-sm text-black/65">
                <p className="font-medium text-black">{loginMessages.registerPrompt}</p>
                <a
                  href="/register"
                  className="mt-2 inline-flex text-sm font-medium text-black underline underline-offset-4 decoration-black"
                >
                  {loginMessages.registerLink}
                </a>
              </div>

              <p className="mt-5 text-[11px] uppercase tracking-[0.24em] text-black/40">
                {loginMessages.versionLabel} {APP_VERSION_LABEL}
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
