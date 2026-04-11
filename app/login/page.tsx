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
    <main className="min-h-screen bg-[var(--page)] px-4 py-8 sm:px-6">
      <div className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-6xl overflow-hidden rounded-[2rem] border border-white/70 bg-white shadow-xl lg:grid-cols-[1.1fr_0.9fr]">
        <section className="relative hidden overflow-hidden bg-slate-950 px-10 py-12 text-white lg:block">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_rgba(34,197,94,0.32),transparent_35%),radial-gradient(circle_at_bottom_left,_rgba(37,99,235,0.32),transparent_45%)]" />
          <div className="relative space-y-8">
            <div>
              <p className="text-xs uppercase tracking-[0.4em] text-emerald-200">
                {loginMessages.heroKicker}
              </p>
              <h1 className="mt-4 font-serif text-7xl leading-none tracking-tight">
                {loginMessages.brandName}
              </h1>
              <p className="mt-5 max-w-md text-sm leading-6 text-slate-300">
                {loginMessages.brandIntro}
              </p>
              <h2 className="mt-8 max-w-xl font-serif text-4xl leading-tight text-white">
                {loginMessages.heroTitle}
              </h2>
              <p className="mt-4 max-w-lg text-sm leading-7 text-slate-300">
                {loginMessages.heroCopy}
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              {loginMessages.features.map(([label, copy]) => (
                <div key={label} className="rounded-3xl border border-white/10 bg-white/5 p-5">
                  <p className="text-sm font-semibold text-white">{label}</p>
                  <p className="mt-2 text-sm text-slate-300">{copy}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="flex items-center px-6 py-10 sm:px-10">
          <div className="mx-auto w-full max-w-md">
            <p className="text-xs uppercase tracking-[0.35em] text-slate-500">{loginMessages.kicker}</p>
            <h2 className="mt-3 font-serif text-4xl text-slate-950">{loginMessages.title}</h2>
            <p className="mt-3 text-sm text-slate-600">{loginMessages.description}</p>

            <form action={loginAction} className="mt-8 space-y-4">
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">
                  {loginMessages.emailLabel}
                </span>
                <input
                  name="email"
                  type="email"
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none"
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">
                  {loginMessages.passwordLabel}
                </span>
                <input
                  name="password"
                  type="password"
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none"
                />
              </label>

              {params.error ? (
                <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {loginMessages.invalidCredentials}
                </p>
              ) : null}

              <button className="w-full rounded-2xl bg-slate-950 px-4 py-3 font-medium text-white">
                {loginMessages.submit}
              </button>
            </form>

            <div className="mt-6 rounded-3xl border border-slate-200 bg-white px-5 py-4 text-sm text-slate-600">
              <p className="font-medium text-slate-900">{loginMessages.registerPrompt}</p>
              <a href="/register" className="mt-2 inline-flex text-sm font-medium text-slate-950 underline underline-offset-4">
                {loginMessages.registerLink}
              </a>
            </div>

            <p className="mt-4 text-xs uppercase tracking-[0.2em] text-slate-400">
              {loginMessages.versionLabel} {APP_VERSION_LABEL}
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
