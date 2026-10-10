"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  confirmEmailChangeAction,
  sendEmailChangeCodeAction,
  updateAccountPasswordAction,
  type EmailChangeResult,
} from "@/lib/account-settings-actions";
import { getMessages, type Locale } from "@/lib/i18n";

type EmailError = Extract<EmailChangeResult, { ok: false }>["error"];

const labelClass = "mb-1 block text-[11px] font-semibold text-[var(--ink-soft)]";

/**
 * The login email and the password, in one card: both are how this
 * person gets in. The email changes in two steps -- the current password
 * and the new address, then the code sent to that address -- so a typo
 * or an inbox nobody reads never becomes the way in.
 */
export function AccountLoginSecurity({ currentEmail, locale }: { currentEmail: string; locale: Locale }) {
  const t = getMessages(locale).accountSettingsPage;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [step, setStep] = useState<"idle" | "request" | "code">("idle");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<EmailError | null>(null);
  const [changedTo, setChangedTo] = useState<string | null>(null);

  const reset = () => {
    setStep("idle");
    setEmail("");
    setPassword("");
    setCode("");
    setError(null);
  };

  const sendCode = () => {
    setError(null);
    startTransition(async () => {
      const result = await sendEmailChangeCodeAction({ email, currentPassword: password });
      if (result.ok) {
        setStep("code");
        setCode("");
      } else {
        setError(result.error);
      }
    });
  };

  const confirm = () => {
    setError(null);
    startTransition(async () => {
      const result = await confirmEmailChangeAction({ email, code });
      if (result.ok) {
        setChangedTo(result.email ?? email);
        reset();
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  };

  return (
    <section className="rounded-lg border border-[var(--line)] bg-[var(--panel-strong)] px-3 py-3 sm:px-4">
      <h2 className="text-[1rem] font-semibold text-[var(--ink)]">{t.loginTitle}</h2>
      <p className="mt-1.5 text-[12px] leading-5 text-[var(--ink-soft)]">{t.loginCopy}</p>

      <div className="mt-3 space-y-3">
        <div className="rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold text-[var(--ink-soft)]">{t.emailTitle}</p>
              <p className="truncate text-[13px] font-medium text-[var(--ink)]">{currentEmail}</p>
            </div>
            {step === "idle" ? (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setChangedTo(null);
                  setStep("request");
                }}
              >
                {t.changeEmail}
              </button>
            ) : null}
          </div>

          {changedTo && step === "idle" ? (
            <p className="mt-2 rounded-md bg-emerald-50 px-2.5 py-1.5 text-[12px] text-emerald-800">{t.emailChanged(changedTo)}</p>
          ) : null}

          {step === "request" ? (
            <form
              className="mt-3 grid gap-3 sm:grid-cols-2"
              onSubmit={(event) => {
                event.preventDefault();
                sendCode();
              }}
            >
              <p className="text-[11.5px] leading-5 text-[var(--ink-soft)] sm:col-span-2">{t.emailCopy}</p>
              <label className="block min-w-0">
                <span className={labelClass}>{t.newEmailLabel}</span>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  maxLength={160}
                  autoComplete="email"
                  autoFocus
                  className="input"
                />
              </label>
              <label className="block min-w-0">
                <span className={labelClass}>{t.currentPasswordLabel}</span>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  autoComplete="current-password"
                  className="input"
                />
              </label>
              <div className="flex flex-wrap gap-2 sm:col-span-2">
                <button className="btn-primary" type="submit" disabled={isPending}>
                  {isPending ? t.sendingCode : t.sendCode}
                </button>
                <button type="button" className="btn-secondary" onClick={reset} disabled={isPending}>
                  {t.cancel}
                </button>
              </div>
            </form>
          ) : null}

          {step === "code" ? (
            <form
              className="mt-3 space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                confirm();
              }}
            >
              <p className="rounded-md bg-[var(--surface-muted)] px-2.5 py-1.5 text-[12px] text-[var(--ink)]">{t.codeSent(email)}</p>
              <label className="block max-w-[12rem]">
                <span className={labelClass}>{t.codeLabel}</span>
                <input
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="\d{6}"
                  required
                  autoFocus
                  placeholder="000000"
                  className="input text-center font-mono text-[16px] tracking-[0.4em]"
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <button className="btn-primary" type="submit" disabled={isPending || code.length !== 6}>
                  {isPending ? t.confirming : t.confirmEmail}
                </button>
                <button type="button" className="btn-secondary" onClick={sendCode} disabled={isPending}>
                  {t.resendCode}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setStep("request");
                    setError(null);
                  }}
                  disabled={isPending}
                >
                  {t.useAnotherEmail}
                </button>
              </div>
            </form>
          ) : null}

          {error && step !== "idle" ? (
            <p role="alert" className="mt-2 rounded-md bg-red-50 px-2.5 py-1.5 text-[12px] text-red-800">
              {t.emailErrors[error]}
            </p>
          ) : null}
        </div>

        <div className="rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 py-2.5">
          <p className="text-[11px] font-semibold text-[var(--ink-soft)]">{t.passwordTitle}</p>
          <p className="mt-0.5 text-[11.5px] leading-5 text-[var(--ink-soft)]">{t.passwordCopy}</p>
          <form action={updateAccountPasswordAction} className="mt-2 grid gap-3 sm:grid-cols-3">
            <label className="block min-w-0">
              <span className={labelClass}>{t.currentPasswordLabel}</span>
              <input name="currentPassword" type="password" required autoComplete="current-password" className="input" />
            </label>
            <label className="block min-w-0">
              <span className={labelClass}>{t.newPasswordLabel}</span>
              <input
                name="newPassword"
                type="password"
                minLength={8}
                maxLength={128}
                required
                autoComplete="new-password"
                className="input"
              />
            </label>
            <label className="block min-w-0">
              <span className={labelClass}>{t.confirmPasswordLabel}</span>
              <input
                name="confirmPassword"
                type="password"
                minLength={8}
                maxLength={128}
                required
                autoComplete="new-password"
                className="input"
              />
            </label>
            <div className="sm:col-span-3">
              <button className="btn-primary" type="submit">
                {t.savePassword}
              </button>
            </div>
          </form>
        </div>
      </div>
    </section>
  );
}
