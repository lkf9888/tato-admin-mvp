"use client";

import { useState, useTransition } from "react";

import { getMessages, type Locale } from "@/lib/i18n";

/** On a direct booking's order page: send the renter's confirmation again. */
export function DirectBookingOrderEmails({ locale, orderId }: { locale: Locale; orderId: string }) {
  const copy = getMessages(locale).directBookingOrderEmails;
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function resend() {
    setResult(null);
    startTransition(async () => {
      const response = await fetch(`/api/direct-booking/orders/${orderId}/confirmation`, {
        method: "POST",
      });
      const data = (await response.json().catch(() => ({}))) as { to?: string; error?: string };
      setResult(
        response.ok
          ? { ok: true, text: copy.sent(data.to ?? "") }
          : { ok: false, text: copy.failed(data.error ?? String(response.status)) },
      );
    });
  }

  return (
    <section className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-3 sm:px-4">
      <p className="t-eyebrow text-[var(--ink-soft)]">{copy.title}</p>
      <p className="mt-1 text-[12px] leading-5 text-[var(--ink-soft)]">{copy.copy}</p>
      <button
        type="button"
        onClick={resend}
        disabled={pending}
        className="mt-2 rounded-md border border-[var(--line)] bg-white px-3 py-1.5 text-[12px] font-medium text-[var(--ink)] hover:bg-[var(--surface-muted)] disabled:opacity-60"
      >
        {pending ? copy.sending : copy.resendConfirmation}
      </button>
      {result ? (
        <p
          className={`mt-2 text-[12px] leading-5 ${
            result.ok ? "text-[color:var(--ok-fg)]" : "text-[color:var(--bad-fg)]"
          }`}
        >
          {result.text}
        </p>
      ) : null}
    </section>
  );
}
