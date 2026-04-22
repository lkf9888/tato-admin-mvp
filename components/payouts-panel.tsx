"use client";

import { useState, useTransition } from "react";

import { getMessages, type Locale } from "@/lib/i18n";
import {
  continueConnectOnboarding,
  openConnectDashboard,
  refreshConnectStatus,
  startConnectOnboarding,
} from "@/lib/payouts-actions";

type ConnectStatus = "not_started" | "pending" | "restricted" | "active";

type PayoutsSnapshot = {
  accountId: string | null;
  country: "CA" | "US" | null;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  onboardedAtLabel: string | null;
};

const STATUS_TONE: Record<
  ConnectStatus,
  {
    dot: string;
    card: string;
  }
> = {
  not_started: {
    dot: "bg-slate-400",
    card: "border-slate-200 bg-slate-50/60",
  },
  pending: {
    dot: "bg-amber-500",
    card: "border-amber-200 bg-amber-50/70",
  },
  restricted: {
    dot: "bg-orange-500",
    card: "border-orange-200 bg-orange-50/70",
  },
  active: {
    dot: "bg-emerald-500",
    card: "border-emerald-200 bg-emerald-50/80",
  },
};

export function PayoutsPanel({
  locale,
  configured,
  snapshot,
  status,
  returnedFromStripe,
}: {
  locale: Locale;
  configured: boolean;
  snapshot: PayoutsSnapshot;
  status: ConnectStatus;
  returnedFromStripe: boolean;
}) {
  const messages = getMessages(locale);
  const t = messages.payoutsPage;

  const [country, setCountry] = useState<"CA" | "US">(snapshot.country ?? "CA");
  const [error, setError] = useState<string>("");
  const [notice, setNotice] = useState<string>(returnedFromStripe ? t.returnedNotice : "");
  const [isStarting, startStart] = useTransition();
  const [isResuming, startResume] = useTransition();
  const [isDashboardOpening, startDashboard] = useTransition();
  const [isRefreshing, startRefresh] = useTransition();

  const statusTone = STATUS_TONE[status];

  const statusTitle =
    status === "active"
      ? t.statusActiveTitle
      : status === "restricted"
        ? t.statusRestrictedTitle
        : status === "pending"
          ? t.statusPendingTitle
          : t.statusNotStartedTitle;
  const statusCopy =
    status === "active"
      ? t.statusActiveCopy
      : status === "restricted"
        ? t.statusRestrictedCopy
        : status === "pending"
          ? t.statusPendingCopy
          : t.statusNotStartedCopy;

  function handleStart() {
    if (!configured) return;
    setError("");
    setNotice("");
    const formData = new FormData();
    formData.set("country", country);
    startStart(async () => {
      const result = await startConnectOnboarding(formData);
      if (!result.ok) {
        setError(result.error || t.genericError);
        return;
      }
      window.location.href = result.url;
    });
  }

  function handleResume() {
    if (!configured) return;
    setError("");
    setNotice("");
    startResume(async () => {
      const result = await continueConnectOnboarding();
      if (!result.ok) {
        setError(result.error || t.genericError);
        return;
      }
      window.location.href = result.url;
    });
  }

  function handleDashboard() {
    if (!configured) return;
    setError("");
    setNotice("");
    startDashboard(async () => {
      const result = await openConnectDashboard();
      if (!result.ok) {
        setError(result.error || t.genericError);
        return;
      }
      window.open(result.url, "_blank", "noopener,noreferrer");
    });
  }

  function handleRefresh() {
    if (!configured) return;
    setError("");
    setNotice("");
    startRefresh(async () => {
      const result = await refreshConnectStatus();
      if (!result.ok) {
        setError(result.error || t.genericError);
        return;
      }
      setNotice(status === "active" ? t.refreshedNotice : t.refreshedPendingNotice);
      // Server action revalidated the path; Next will re-render this route.
    });
  }

  return (
    <div className="space-y-6">
      <header className="rounded-3xl border border-[var(--line)] bg-[var(--panel)] px-8 py-7">
        <p className="text-[11px] uppercase tracking-[0.38em] text-[var(--ink-soft)]">
          {t.kicker}
        </p>
        <h1 className="mt-2 font-serif text-[2rem] font-semibold leading-tight text-[var(--ink)]">
          {t.title}
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--ink-soft)]">{t.copy}</p>
        <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-white/60 px-3 py-1 text-xs text-[var(--ink-soft)]">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
          {t.platformFeeNote}
        </div>
      </header>

      {!configured && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-800">
          {t.notConfigured}
        </div>
      )}

      <section className="rounded-3xl border border-[var(--line)] bg-[var(--panel)] px-8 py-6">
        <p className="text-[11px] uppercase tracking-[0.38em] text-[var(--ink-soft)]">
          {t.howItWorks}
        </p>
        <ol className="mt-3 space-y-2 text-sm leading-relaxed text-[var(--ink)]">
          {t.howSteps.map((step, index) => (
            <li key={index} className="flex gap-3">
              <span className="mt-0.5 inline-flex h-5 w-5 flex-none items-center justify-center rounded-full bg-[var(--accent)]/10 text-[11px] font-semibold text-[var(--accent)]">
                {index + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className={`rounded-3xl border px-8 py-6 ${statusTone.card}`}>
        <p className="text-[11px] uppercase tracking-[0.38em] text-[var(--ink-soft)]">
          {t.statusKicker}
        </p>
        <div className="mt-2 flex items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${statusTone.dot}`} />
          <h2 className="text-lg font-semibold text-[var(--ink)]">{statusTitle}</h2>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-[var(--ink-soft)]">{statusCopy}</p>

        {snapshot.accountId && (
          <dl className="mt-5 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-[11px] uppercase tracking-[0.3em] text-[var(--ink-soft)]">
                {t.accountIdLabel}
              </dt>
              <dd className="mt-1 font-mono text-xs text-[var(--ink)] break-all">
                {snapshot.accountId}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-[0.3em] text-[var(--ink-soft)]">
                {t.countryFieldLabel}
              </dt>
              <dd className="mt-1 text-[var(--ink)]">
                {snapshot.country === "CA"
                  ? t.countryCA
                  : snapshot.country === "US"
                    ? t.countryUS
                    : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-[0.3em] text-[var(--ink-soft)]">
                {t.chargesLabel}
              </dt>
              <dd className="mt-1 text-[var(--ink)]">
                {snapshot.chargesEnabled ? t.enabled : t.disabled}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-[0.3em] text-[var(--ink-soft)]">
                {t.payoutsLabel}
              </dt>
              <dd className="mt-1 text-[var(--ink)]">
                {snapshot.payoutsEnabled ? t.enabled : t.disabled}
              </dd>
            </div>
            {snapshot.onboardedAtLabel && (
              <div className="sm:col-span-2">
                <dt className="text-[11px] uppercase tracking-[0.3em] text-[var(--ink-soft)]">
                  {t.onboardedAtLabel}
                </dt>
                <dd className="mt-1 text-[var(--ink)]">{snapshot.onboardedAtLabel}</dd>
              </div>
            )}
          </dl>
        )}
      </section>

      <section className="rounded-3xl border border-[var(--line)] bg-[var(--panel)] px-8 py-6">
        {status === "not_started" ? (
          <div className="space-y-4">
            <div>
              <label className="text-[11px] uppercase tracking-[0.3em] text-[var(--ink-soft)]">
                {t.countryLabel}
              </label>
              <div className="mt-3 flex gap-2">
                {(["CA", "US"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setCountry(option)}
                    className={`rounded-full border px-4 py-2 text-sm transition ${
                      country === option
                        ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                        : "border-[var(--line)] bg-white text-[var(--ink)] hover:bg-[var(--surface-muted)]"
                    }`}
                  >
                    {option === "CA" ? t.countryCA : t.countryUS}
                  </button>
                ))}
              </div>
            </div>
            <button
              type="button"
              onClick={handleStart}
              disabled={!configured || isStarting}
              className="inline-flex items-center justify-center rounded-full bg-[var(--ink)] px-6 py-3 text-sm font-medium text-white transition hover:bg-[var(--ink)]/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isStarting ? t.connectLoading : t.connectAction}
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-3">
            {status !== "active" && (
              <button
                type="button"
                onClick={handleResume}
                disabled={!configured || isResuming}
                className="inline-flex items-center justify-center rounded-full bg-[var(--ink)] px-5 py-2.5 text-sm font-medium text-white transition hover:bg-[var(--ink)]/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isResuming ? t.connectLoading : t.continueAction}
              </button>
            )}
            <button
              type="button"
              onClick={handleDashboard}
              disabled={!configured || isDashboardOpening}
              className="inline-flex items-center justify-center rounded-full border border-[var(--line)] bg-white px-5 py-2.5 text-sm font-medium text-[var(--ink)] transition hover:bg-[var(--surface-muted)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {t.dashboardAction}
            </button>
            <button
              type="button"
              onClick={handleRefresh}
              disabled={!configured || isRefreshing}
              className="inline-flex items-center justify-center rounded-full border border-[var(--line)] bg-white px-5 py-2.5 text-sm font-medium text-[var(--ink)] transition hover:bg-[var(--surface-muted)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isRefreshing ? t.refreshing : t.refreshAction}
            </button>
          </div>
        )}

        {error && (
          <p className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
            {error}
          </p>
        )}
        {notice && !error && (
          <p className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
            {notice}
          </p>
        )}
      </section>
    </div>
  );
}
