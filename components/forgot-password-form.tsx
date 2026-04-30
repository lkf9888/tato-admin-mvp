"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  requestPasswordResetCodeAction,
  resetPasswordAction,
} from "@/app/actions";
import { getMessages, type Locale } from "@/lib/i18n";

type ErrorKey =
  | "invalid"
  | "throttled"
  | "no_pending_code"
  | "expired"
  | "invalid_code"
  | "too_many_attempts"
  | "generic";

export function ForgotPasswordForm({ locale }: { locale: Locale }) {
  const router = useRouter();
  const t = getMessages(locale).forgotPassword;

  const [step, setStep] = useState<"email" | "verify" | "done">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<ErrorKey | null>(null);
  const [resendNotice, setResendNotice] = useState<string | null>(null);
  const [isSendingCode, startSendCode] = useTransition();
  const [isResetting, startReset] = useTransition();

  const errorMessage = (() => {
    if (!error) return null;
    switch (error) {
      case "invalid":
        return t.invalidInput;
      case "throttled":
        return t.throttled;
      case "no_pending_code":
        return t.noPendingCode;
      case "expired":
        return t.expired;
      case "invalid_code":
        return t.invalidCode;
      case "too_many_attempts":
        return t.tooManyAttempts;
      default:
        return t.genericError;
    }
  })();

  function handleSendCode() {
    setError(null);
    setResendNotice(null);
    startSendCode(async () => {
      const result = await requestPasswordResetCodeAction({ email });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setStep("verify");
    });
  }

  function handleResendCode() {
    setError(null);
    setResendNotice(null);
    startSendCode(async () => {
      const result = await requestPasswordResetCodeAction({ email });
      if (!result.ok) {
        if (result.error === "throttled") {
          setResendNotice(t.resendCooldown);
        } else {
          setError(result.error);
        }
        return;
      }
      setResendNotice(t.resendSuccess);
    });
  }

  function handleReset() {
    setError(null);
    setResendNotice(null);
    startReset(async () => {
      const result = await resetPasswordAction({ email, code, password });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setStep("done");
    });
  }

  if (step === "done") {
    return (
      <div>
        <p className="text-[11px] uppercase tracking-[0.35em] text-black/55">{t.doneKicker}</p>
        <h2 className="mt-3 font-serif text-[2.2rem] leading-tight text-black">{t.doneTitle}</h2>
        <p className="mt-3 text-[13px] leading-6 text-black/55">{t.doneCopy}</p>

        <button
          type="button"
          onClick={() => router.replace("/login")}
          className="mt-7 w-full rounded-full bg-black px-4 py-3.5 font-medium text-white shadow-[0_16px_34px_rgba(17,19,24,0.16)] transition hover:translate-y-[-1px] hover:bg-[#1a1d24]"
        >
          {t.backToLogin}
        </button>
      </div>
    );
  }

  if (step === "verify") {
    const verifyDescription = email
      ? `${t.verifyDescriptionPrefix}${email}${t.verifyDescriptionSuffix}`
      : t.verifyDescriptionFallback;

    return (
      <div>
        <p className="text-[11px] uppercase tracking-[0.35em] text-black/55">{t.verifyStepKicker}</p>
        <h2 className="mt-3 font-serif text-[2.2rem] leading-tight text-black">{t.verifyTitle}</h2>
        <p className="mt-3 text-[13px] leading-6 text-black/55">{verifyDescription}</p>

        <div className="mt-6 space-y-4">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-black">{t.codeLabel}</span>
            <input
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
              inputMode="numeric"
              autoFocus
              autoComplete="one-time-code"
              placeholder={t.codePlaceholder}
              className="w-full rounded-full border border-black/15 bg-white px-4 py-3.5 text-center text-[18px] font-mono tracking-[0.4em] outline-none"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-black">{t.newPasswordLabel}</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              placeholder={t.newPasswordPlaceholder}
              className="w-full rounded-full border border-black/15 bg-white px-4 py-3.5 text-[14px] outline-none"
            />
            <span className="mt-2 block text-[11px] text-black/45">{t.newPasswordHint}</span>
          </label>

          {errorMessage ? (
            <p className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {errorMessage}
            </p>
          ) : null}

          {resendNotice ? (
            <p className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              {resendNotice}
            </p>
          ) : null}

          <button
            type="button"
            onClick={handleReset}
            disabled={isResetting || code.length < 6 || password.length < 8}
            className="w-full rounded-full bg-black px-4 py-3.5 font-medium text-white shadow-[0_16px_34px_rgba(17,19,24,0.16)] transition hover:translate-y-[-1px] hover:bg-[#1a1d24] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isResetting ? t.resettingAction : t.resetAction}
          </button>

          <div className="flex items-center justify-between text-[13px]">
            <button
              type="button"
              onClick={handleResendCode}
              disabled={isSendingCode}
              className="font-medium text-black underline underline-offset-4 decoration-black disabled:opacity-50"
            >
              {isSendingCode ? t.sendingCode : t.resendAction}
            </button>
            <button
              type="button"
              onClick={() => {
                setStep("email");
                setError(null);
                setResendNotice(null);
                setCode("");
                setPassword("");
              }}
              className="text-black/55 hover:text-black"
            >
              {t.backToEmail}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.35em] text-black/55">{t.kicker}</p>
      <h2 className="mt-3 font-serif text-[2.85rem] leading-none text-black">{t.title}</h2>
      <p className="mt-3 text-[13px] leading-6 text-black/55">{t.description}</p>

      <div className="mt-8 space-y-4">
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-black">{t.emailLabel}</span>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            className="w-full rounded-full border border-black/15 bg-white px-4 py-3.5 text-[14px] outline-none"
          />
        </label>

        {errorMessage ? (
          <p className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {errorMessage}
          </p>
        ) : null}

        <button
          type="button"
          onClick={handleSendCode}
          disabled={isSendingCode || !email.trim()}
          className="w-full rounded-full bg-black px-4 py-3.5 font-medium text-white shadow-[0_16px_34px_rgba(17,19,24,0.16)] transition hover:translate-y-[-1px] hover:bg-[#1a1d24] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSendingCode ? t.sendingCode : t.sendCode}
        </button>

        <p className="text-[13px] text-black/55">
          {t.privacyHint}
        </p>
      </div>
    </div>
  );
}
