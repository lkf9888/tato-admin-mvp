"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  requestRegistrationCodeAction,
  verifyAndRegisterAction,
} from "@/app/actions";
import { getMessages, type Locale } from "@/lib/i18n";

type ErrorKey =
  | "invalid"
  | "exists"
  | "throttled"
  | "no_pending_code"
  | "expired"
  | "invalid_code"
  | "too_many_attempts"
  | "generic";

export function RegisterForm({ locale }: { locale: Locale }) {
  const router = useRouter();
  const t = getMessages(locale).register;

  const [step, setStep] = useState<"details" | "verify">("details");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<ErrorKey | null>(null);
  const [emailDeliveryNotice, setEmailDeliveryNotice] = useState<
    "delivered" | "logged" | null
  >(null);
  const [resendNotice, setResendNotice] = useState<string | null>(null);
  const [isSendingCode, startSendCode] = useTransition();
  const [isVerifying, startVerify] = useTransition();

  const errorMessage = (() => {
    if (!error) return null;
    switch (error) {
      case "invalid":
        return t.invalidInput;
      case "exists":
        return t.emailExists;
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
      const result = await requestRegistrationCodeAction({
        name,
        email,
        password,
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      setEmailDeliveryNotice(result.sent ? "delivered" : "logged");
      setStep("verify");
    });
  }

  function handleResendCode() {
    setError(null);
    setResendNotice(null);
    startSendCode(async () => {
      const result = await requestRegistrationCodeAction({
        name,
        email,
        password,
      });

      if (!result.ok) {
        if (result.error === "throttled") {
          setResendNotice(t.resendCooldown);
        } else {
          setError(result.error);
        }
        return;
      }

      setEmailDeliveryNotice(result.sent ? "delivered" : "logged");
      setResendNotice(t.resendSuccess);
    });
  }

  function handleVerify() {
    setError(null);
    setResendNotice(null);
    startVerify(async () => {
      const result = await verifyAndRegisterAction({
        name,
        email,
        password,
        code,
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      router.replace("/dashboard");
      router.refresh();
    });
  }

  if (step === "verify") {
    const verifyDescription = email
      ? `${t.verifyDescriptionPrefix}${email}${t.verifyDescriptionSuffix}`
      : t.verifyDescriptionFallback;

    return (
      <div>
        <p className="text-[11px] uppercase tracking-[0.35em] text-[var(--ink-soft)]">
          {t.verifyStepKicker}
        </p>
        <h2 className="mt-3 font-serif text-[2.2rem] leading-tight text-[var(--ink)]">
          {t.verifyTitle}
        </h2>
        <p className="mt-3 text-[13px] leading-6 text-[var(--ink-soft)]">{verifyDescription}</p>

        {emailDeliveryNotice === "logged" ? (
          <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {t.smtpFallbackNotice}
          </p>
        ) : null}

        <div className="mt-6 space-y-4">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-[var(--ink)]">{t.codeLabel}</span>
            <input
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
              inputMode="numeric"
              autoFocus
              autoComplete="one-time-code"
              placeholder={t.codePlaceholder}
              className="w-full rounded-full border border-[var(--line)] bg-[var(--surface-muted)] px-4 py-3.5 text-center text-[18px] font-mono tracking-[0.4em] outline-none"
            />
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
            onClick={handleVerify}
            disabled={isVerifying || code.length < 6}
            className="w-full rounded-full bg-[var(--ink)] px-4 py-3.5 font-medium text-white shadow-[0_16px_34px_rgba(17,19,24,0.16)] transition hover:translate-y-[-1px] hover:bg-[#1a1d24] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isVerifying ? t.verifying : t.verifyAction}
          </button>

          <div className="flex items-center justify-between text-[13px]">
            <button
              type="button"
              onClick={handleResendCode}
              disabled={isSendingCode}
              className="font-medium text-[var(--ink)] underline underline-offset-4 decoration-[var(--accent)] disabled:opacity-50"
            >
              {isSendingCode ? t.sendingCode : t.resendAction}
            </button>
            <button
              type="button"
              onClick={() => {
                setStep("details");
                setError(null);
                setResendNotice(null);
                setCode("");
              }}
              className="text-[var(--ink-soft)] hover:text-[var(--ink)]"
            >
              {t.backToDetails}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.35em] text-[var(--ink-soft)]">{t.kicker}</p>
      <h2 className="mt-3 font-serif text-[2.85rem] leading-none text-[var(--ink)]">{t.title}</h2>
      <p className="mt-3 text-[13px] leading-6 text-[var(--ink-soft)]">{t.description}</p>

      <div className="mt-8 space-y-4">
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-[var(--ink)]">{t.nameLabel}</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="name"
            className="w-full rounded-full border border-[var(--line)] bg-[var(--surface-muted)] px-4 py-3.5 text-[14px] outline-none"
          />
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-medium text-[var(--ink)]">{t.emailLabel}</span>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            className="w-full rounded-full border border-[var(--line)] bg-[var(--surface-muted)] px-4 py-3.5 text-[14px] outline-none"
          />
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-medium text-[var(--ink)]">{t.passwordLabel}</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            className="w-full rounded-full border border-[var(--line)] bg-[var(--surface-muted)] px-4 py-3.5 text-[14px] outline-none"
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
          disabled={
            isSendingCode || !name.trim() || !email.trim() || password.length < 6
          }
          className="w-full rounded-full bg-[var(--ink)] px-4 py-3.5 font-medium text-white shadow-[0_16px_34px_rgba(17,19,24,0.16)] transition hover:translate-y-[-1px] hover:bg-[#1a1d24] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSendingCode ? t.sendingCode : t.sendCode}
        </button>
      </div>
    </div>
  );
}
