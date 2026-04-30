import { redirect } from "next/navigation";

import { CompactLanguageSwitcher } from "@/components/language-switcher";
import { ForgotPasswordForm } from "@/components/forgot-password-form";
import { isAdminAuthenticated } from "@/lib/auth";
import { getI18n } from "@/lib/i18n-server";
import { APP_VERSION_LABEL } from "@/lib/version";

export default async function ForgotPasswordPage() {
  const authenticated = await isAdminAuthenticated();
  if (authenticated) redirect("/dashboard");

  const { locale, messages } = await getI18n();
  const loginMessages = messages.login;
  const forgotMessages = messages.forgotPassword;

  return (
    <main className="min-h-screen bg-white text-black">
      <div className="mx-auto flex min-h-screen max-w-[86rem] flex-col lg:grid lg:grid-cols-[1.18fr_0.82fr] lg:overflow-hidden">
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
                {forgotMessages.heroTitle}
              </h2>
              <p className="mt-5 max-w-lg text-[14px] leading-7 text-white/70">
                {forgotMessages.heroCopy}
              </p>
            </div>
          </div>
        </section>

        <section className="relative flex flex-1 items-start justify-center bg-white px-4 pb-10 pt-6 sm:px-8 sm:pt-10 lg:items-center lg:px-12 lg:py-10">
          <div className="absolute inset-x-0 top-0 flex items-center justify-between px-4 pt-5 sm:px-8 lg:left-auto lg:right-6 lg:top-6 lg:justify-end">
            <p className="font-serif text-2xl font-semibold tracking-tight text-black lg:hidden">
              {loginMessages.brandName}
            </p>
            <CompactLanguageSwitcher locale={locale} />
          </div>

          <div className="mt-12 w-full max-w-md sm:mt-16 lg:mt-0">
            <div className="rounded-lg border border-black/10 bg-white px-5 py-7 shadow-[0_24px_60px_rgba(0,0,0,0.06)] sm:px-7 sm:py-8">
              <ForgotPasswordForm locale={locale} />

              <div className="mt-6 rounded-lg border border-black/10 bg-black/[0.025] px-5 py-4 text-sm text-black/65">
                <p className="font-medium text-black">{forgotMessages.loginPrompt}</p>
                <a
                  href="/login"
                  className="mt-2 inline-flex text-sm font-medium text-black underline underline-offset-4 decoration-black"
                >
                  {forgotMessages.loginLink}
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
