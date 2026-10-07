"use client";

import { BusyLabel } from "@/components/booking-spinner";
import { useCallback, useEffect, useState } from "react";

import { getMessages, type Locale } from "@/lib/i18n";
import { formatCurrency } from "@/lib/utils";

type Quote = {
  billedDays: number;
  currentDays: number;
  extraDays: number;
  lines: Array<{ label: string; amount: number }>;
  total: number;
  hasSavedCard: boolean;
  renterEmail: string | null;
  pending: Array<{ days: number; amount: number; url?: string | null; at: string }>;
};

/**
 * On a direct booking, after its times were moved: what the longer
 * trip owes, and one click to bill it -- the saved card, or a payment
 * link by email. Self-contained (it fetches its own numbers), so any
 * order view can mount it; remount it (a new `key`) after a save to
 * re-price. Renders nothing for an order that is not a direct booking.
 */
export function BookingExtraChargePanel({ locale, orderId }: { locale: Locale; orderId: string }) {
  const copy = getMessages(locale).bookingExtraCharge;
  const [quote, setQuote] = useState<Quote | null>(null);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [billingMethod, setBillingMethod] = useState<"card" | "link" | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const money = (value: number) => formatCurrency(value, locale);

  const load = useCallback(async () => {
    const response = await fetch(`/api/direct-booking/orders/${orderId}/extra-charge`, { cache: "no-store" });
    if (!response.ok) {
      setHidden(true);
      return;
    }
    setQuote((await response.json()) as Quote);
  }, [orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function bill(method: "card" | "link") {
    if (!quote) return;
    const confirmText =
      method === "card" ? copy.confirmCard(money(quote.total)) : copy.confirmLink(money(quote.total));
    if (!window.confirm(confirmText)) return;
    setBillingMethod(method);
    setBusy(true);
    setResult(null);
    try {
      const response = await fetch(`/api/direct-booking/orders/${orderId}/extra-charge`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ method, expectedTotal: quote.total }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        outcome?: "charged" | "link_sent";
        amount?: number;
        emailed?: boolean;
        fallbackReason?: string;
        error?: string;
      };
      if (!response.ok) {
        setResult({ ok: false, text: copy.errors[data.error as keyof typeof copy.errors] ?? copy.failed(data.error ?? "") });
      } else if (data.outcome === "charged") {
        setResult({ ok: true, text: copy.charged(money(data.amount ?? 0), Boolean(data.emailed)) });
      } else {
        setResult({
          ok: true,
          text: copy.linkSent(money(data.amount ?? 0), Boolean(data.emailed), data.fallbackReason ?? null),
        });
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (hidden || !quote) return null;

  return (
    <section className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-3 sm:px-4">
      <p className="t-eyebrow text-[var(--ink-soft)]">{copy.title}</p>
      <p className="mt-1 text-[12px] leading-5 text-[var(--ink-soft)]">
        {copy.days(quote.billedDays, quote.currentDays)}
      </p>

      {quote.extraDays > 0 ? (
        <>
          <ul className="mt-2 space-y-0.5 text-[12px] text-[var(--ink-mid)]">
            {quote.lines.map((line) => (
              <li key={line.label} className="flex justify-between gap-3">
                <span>{line.label}</span>
                <span className="tabular-nums">{money(line.amount)}</span>
              </li>
            ))}
            <li className="flex justify-between gap-3 border-t border-[var(--line)] pt-1 font-semibold text-[var(--ink)]">
              <span>{copy.total}</span>
              <span className="tabular-nums">{money(quote.total)}</span>
            </li>
          </ul>
          <div className="mt-2 flex flex-wrap gap-2">
            {quote.hasSavedCard ? (
              <button
                type="button"
                onClick={() => void bill("card")}
                disabled={busy}
                className="rounded-md bg-[var(--ink)] px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-60"
                style={{ backgroundColor: "var(--ink)", color: "#ffffff" }}
              >
                <BusyLabel busy={busy && billingMethod === "card"} idle={copy.chargeCard(money(quote.total))} working={copy.working} />
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void bill("link")}
              disabled={busy}
              className="rounded-md border border-[var(--line)] bg-white px-3 py-1.5 text-[12px] font-medium text-[var(--ink)] hover:bg-[var(--surface-muted)] disabled:opacity-60"
            >
              <BusyLabel busy={busy && billingMethod === "link"} idle={copy.sendLink} working={copy.working} />
            </button>
          </div>
          <p className="mt-1.5 text-[11px] leading-4 text-[var(--ink-soft)]">
            {quote.hasSavedCard ? copy.savedCardNote : copy.noSavedCardNote}
            {quote.renterEmail ? ` ${copy.emailTo(quote.renterEmail)}` : ` ${copy.noEmail}`}
          </p>
        </>
      ) : (
        <p className="mt-1 text-[12px] text-[var(--ink-mid)]">{copy.nothingDue}</p>
      )}

      {quote.pending.length > 0 ? (
        <div className="mt-2 space-y-1">
          {quote.pending.map((item) => (
            <p key={item.at} className="text-[11px] text-[color:var(--ink-mid)]">
              {copy.pendingLink(item.days, money(item.amount))}{" "}
              {item.url ? (
                <a href={item.url} target="_blank" rel="noreferrer" className="underline">
                  {copy.openLink}
                </a>
              ) : null}
            </p>
          ))}
        </div>
      ) : null}

      {result ? (
        <p className={`mt-2 text-[12px] leading-5 ${result.ok ? "text-[color:var(--ok-fg)]" : "text-[color:var(--bad-fg)]"}`}>
          {result.text}
        </p>
      ) : null}
    </section>
  );
}
