"use client";

import { BusyLabel } from "@/components/booking-spinner";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { getMessages, type Locale } from "@/lib/i18n";
import { formatCurrency } from "@/lib/utils";

type Info = {
  isCancelled: boolean;
  paidAmount: number;
  depositAmount: number;
  policyRefund: number;
  outcome: "free" | "late" | "started";
  canRefund: boolean;
  renterEmail: string | null;
};

type Choice = "policy" | "full" | "none" | "custom";

/**
 * Cancel a direct booking from the admin, with its refund. Deleting a
 * paid online booking from the calendar used to cancel it and leave the
 * renter's money where it was; this is the way that sends it back and
 * tells the renter. Self-contained, like the extra-days panel; renders
 * nothing for an order that is not a direct booking or is cancelled.
 */
export function DirectBookingCancelPanel({
  locale,
  orderId,
  onDone,
}: {
  locale: Locale;
  orderId: string;
  /** Called after a successful cancel; defaults to refreshing the page. */
  onDone?: () => void;
}) {
  const copy = getMessages(locale).directBookingCancel;
  const router = useRouter();
  const [info, setInfo] = useState<Info | null>(null);
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<Choice>("policy");
  const [custom, setCustom] = useState("");
  const [archive, setArchive] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const money = (value: number) => formatCurrency(value, locale);

  useEffect(() => {
    let alive = true;
    void fetch(`/api/direct-booking/orders/${orderId}/cancel`, { cache: "no-store" }).then(async (response) => {
      if (!alive || !response.ok) return;
      setInfo((await response.json()) as Info);
    });
    return () => {
      alive = false;
    };
  }, [orderId]);

  if (!info || info.isCancelled) return null;

  const amount = !info.canRefund
    ? 0
    : choice === "policy"
      ? info.policyRefund
      : choice === "full"
        ? info.paidAmount
        : choice === "none"
          ? 0
          : Number(custom) || 0;
  const invalid = choice === "custom" && (!(Number(custom) >= 0) || Number(custom) > info.paidAmount);

  async function submit() {
    if (invalid) return;
    if (!window.confirm(copy.confirm(money(amount)))) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/direct-booking/orders/${orderId}/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refundAmount: amount, archive, note: note || undefined }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        refundAmount?: number;
        emailed?: boolean;
        error?: string;
        detail?: string;
      };
      if (!response.ok) {
        setMessage({ ok: false, text: copy.failed(data.detail || data.error || String(response.status)) });
        return;
      }
      setMessage({ ok: true, text: copy.done(money(data.refundAmount ?? 0), Boolean(data.emailed)) });
      if (onDone) onDone();
      else router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const radio = (value: Choice, label: string) => (
    <label key={value} className="flex items-center gap-2 text-[12px] text-[var(--ink-mid)]">
      <input type="radio" name={`cancel-refund-${orderId}`} checked={choice === value} onChange={() => setChoice(value)} />
      {label}
    </label>
  );

  return (
    <section className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-3 sm:px-4">
      <div className="flex items-center justify-between gap-2">
        <p className="t-eyebrow text-[var(--ink-soft)]">{copy.title}</p>
        {!open ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-md border border-[color:var(--bad-fg)]/30 px-3 py-1.5 text-[12px] font-medium text-[color:var(--bad-fg)] hover:bg-[var(--bad-bg)]"
          >
            {copy.open}
          </button>
        ) : null}
      </div>
      <p className="mt-1 text-[12px] leading-5 text-[var(--ink-soft)]">
        {copy.summary(money(info.paidAmount), money(info.policyRefund), info.outcome)}
      </p>

      {open ? (
        <div className="mt-2 space-y-2">
          {info.canRefund ? (
            <div className="space-y-1">
              {radio("policy", copy.policy(money(info.policyRefund)))}
              {radio("full", copy.full(money(info.paidAmount)))}
              {radio("none", copy.none)}
              <label className="flex items-center gap-2 text-[12px] text-[var(--ink-mid)]">
                <input type="radio" name={`cancel-refund-${orderId}`} checked={choice === "custom"} onChange={() => setChoice("custom")} />
                {copy.custom}
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={custom}
                  onFocus={() => setChoice("custom")}
                  onChange={(event) => setCustom(event.target.value)}
                  className="h-7 w-24 rounded-md border border-[var(--line)] bg-white px-2 text-[12px] tabular-nums"
                />
              </label>
            </div>
          ) : (
            <p className="text-[12px] text-[var(--ink-soft)]">{copy.noPayment}</p>
          )}
          <label className="flex items-center gap-2 text-[12px] text-[var(--ink-mid)]">
            <input type="checkbox" checked={archive} onChange={(event) => setArchive(event.target.checked)} />
            {copy.archive}
          </label>
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={1000}
            placeholder={copy.notePlaceholder}
            className="h-8 w-full rounded-md border border-[var(--line)] bg-white px-2 text-[12px]"
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void submit()}
              disabled={busy || invalid}
              className="rounded-md px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-60"
              style={{ backgroundColor: "var(--bad-fg)", color: "#ffffff" }}
            >
              <BusyLabel busy={busy} idle={copy.submit(money(amount))} working={copy.working} />
            </button>
            <button type="button" onClick={() => setOpen(false)} className="text-[12px] text-[var(--ink-soft)]">
              {copy.close}
            </button>
          </div>
          <p className="text-[11px] text-[var(--ink-soft)]">
            {info.renterEmail ? copy.emailTo(info.renterEmail) : copy.noEmail}
          </p>
        </div>
      ) : null}

      {message ? (
        <p className={`mt-2 text-[12px] ${message.ok ? "text-[color:var(--ok-fg)]" : "text-[color:var(--bad-fg)]"}`}>
          {message.text}
        </p>
      ) : null}
    </section>
  );
}
