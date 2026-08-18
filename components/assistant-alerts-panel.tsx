"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { getMessages, type Locale } from "@/lib/i18n";

type Alert = {
  id: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  title: string;
  body: string;
  href: string | null;
  acknowledged: boolean;
  updatedAt: string;
};

/** Severity drives the whole visual weight — this list is scanned, not read. */
const TONE: Record<Alert["severity"], string> = {
  CRITICAL: "border-l-[3px] border-l-rose-500 bg-rose-50/60",
  WARNING: "border-l-[3px] border-l-amber-500 bg-amber-50/50",
  INFO: "border-l-[3px] border-l-[var(--line)] bg-[var(--surface-muted)]",
};

const TONE_LABEL: Record<Alert["severity"], { en: string; zh: string }> = {
  CRITICAL: { en: "Urgent", zh: "紧急" },
  WARNING: { en: "Attention", zh: "注意" },
  INFO: { en: "Note", zh: "提示" },
};

const TONE_TEXT: Record<Alert["severity"], string> = {
  CRITICAL: "text-rose-700",
  WARNING: "text-amber-700",
  INFO: "text-[var(--ink-soft)]",
};

export function AssistantAlertsPanel({
  locale,
  initialAlerts,
}: {
  locale: Locale;
  initialAlerts: Alert[];
}) {
  const t = getMessages(locale).assistantPage;
  const router = useRouter();
  const [alerts, setAlerts] = useState(initialAlerts);
  const [scanning, setScanning] = useState(false);

  async function scan() {
    if (scanning) return;
    setScanning(true);
    try {
      await fetch("/api/assistant/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notify: false }),
      });
      const response = await fetch("/api/assistant/alerts");
      const data = (await response.json().catch(() => ({}))) as { alerts?: Alert[] };
      if (data.alerts) setAlerts(data.alerts);
      router.refresh();
    } finally {
      setScanning(false);
    }
  }

  async function acknowledge(alertId: string) {
    // Optimistic: dim it immediately. A failed acknowledge is
    // recoverable by the next scan, so a rollback dance isn't worth it.
    setAlerts((current) =>
      current.map((alert) => (alert.id === alertId ? { ...alert, acknowledged: true } : alert)),
    );
    await fetch("/api/assistant/alerts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alertId }),
    }).catch(() => null);
  }

  const unacknowledged = alerts.filter((alert) => !alert.acknowledged).length;

  return (
    <section className="rounded-lg border border-[var(--line)] bg-[var(--surface)]">
      <header className="flex items-center justify-between gap-2 border-b border-[var(--line)] px-3 py-2.5 sm:px-4">
        <div className="min-w-0">
          <h2 className="text-[13px] font-semibold text-[var(--ink)]">
            {t.alertsTitle}
            {unacknowledged > 0 ? (
              <span className="ml-2 rounded-full bg-rose-100 px-1.5 py-0.5 text-[10.5px] font-bold text-rose-700">
                {unacknowledged}
              </span>
            ) : null}
          </h2>
          <p className="mt-0.5 text-[11.5px] leading-5 text-[var(--ink-soft)]">{t.alertsCopy}</p>
        </div>
        <button
          type="button"
          onClick={scan}
          disabled={scanning}
          className="tap-press shrink-0 rounded-full border border-[var(--line)] bg-white px-3 py-1.5 text-[11.5px] font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {scanning ? t.alertsScanning : t.alertsScan}
        </button>
      </header>

      <div className="px-3 py-2.5 sm:px-4">
        {alerts.length === 0 ? (
          <p className="py-5 text-center text-[12px] text-[var(--ink-soft)]">{t.alertsEmpty}</p>
        ) : (
          <ul className="space-y-2">
            {alerts.map((alert) => (
              <li
                key={alert.id}
                className={`rounded-md px-3 py-2 transition ${TONE[alert.severity]} ${alert.acknowledged ? "opacity-55" : ""}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p
                      className={`text-[10px] font-bold uppercase tracking-[0.1em] ${TONE_TEXT[alert.severity]}`}
                    >
                      {locale === "en"
                        ? TONE_LABEL[alert.severity].en
                        : TONE_LABEL[alert.severity].zh}
                    </p>
                    <p className="mt-0.5 text-[13px] font-semibold leading-5 text-[var(--ink)]">
                      {alert.title}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-[11.5px] leading-5 text-[var(--ink-soft)]">
                      {alert.body}
                    </p>
                    {alert.href ? (
                      <Link
                        href={alert.href}
                        className="mt-1.5 inline-block text-[11.5px] font-semibold text-[var(--accent)] underline underline-offset-2"
                      >
                        {t.alertsOpen}
                      </Link>
                    ) : null}
                  </div>
                  {!alert.acknowledged ? (
                    <button
                      type="button"
                      onClick={() => acknowledge(alert.id)}
                      className="tap-press shrink-0 rounded-full border border-[var(--line)] bg-white px-2.5 py-1 text-[10.5px] font-semibold text-[var(--ink-soft)] transition hover:text-[var(--ink)]"
                    >
                      {t.alertsAcknowledge}
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
