"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { getMessages, type Locale } from "@/lib/i18n";
import { formatCurrency } from "@/lib/utils";

const METHODS = ["cash", "etransfer", "card", "other"] as const;

/**
 * One held deposit's two actions on the deposits page: fill in how a
 * deposit taken in person came in and where it goes back, and settle
 * it -- a card refund for site bookings (the same endpoint as the order
 * page), a record of money given back by hand for the rest.
 */
export function DepositOverviewActions({
  locale,
  orderId,
  amount,
  viaStripe,
  collectedVia,
  collectedOn,
  refundTo,
}: {
  locale: Locale;
  orderId: string;
  amount: number;
  viaStripe: boolean;
  collectedVia: string | null;
  /** `YYYY-MM-DD` or "". */
  collectedOn: string;
  refundTo: string | null;
}) {
  const copy = getMessages(locale).directBookingDeposits;
  const money = (value: number) => formatCurrency(value, locale);
  const router = useRouter();
  const [mode, setMode] = useState<"idle" | "edit" | "settle">("idle");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [depositAmount, setDepositAmount] = useState(amount.toFixed(2));
  const [via, setVia] = useState(collectedVia ?? "");
  const [on, setOn] = useState(collectedOn);
  const [to, setTo] = useState(refundTo ?? "");

  const [refund, setRefund] = useState(amount.toFixed(2));
  const [note, setNote] = useState("");
  const refundValue = Number(refund);
  const validRefund = refund.trim() !== "" && Number.isFinite(refundValue) && refundValue >= 0 && refundValue <= amount + 0.001;
  const kept = validRefund ? Math.max(0, Math.round((amount - refundValue) * 100) / 100) : 0;

  function fail(code: string | undefined) {
    const known = copy.errors as Record<string, string>;
    setError((code && known[code]) || copy.errors.generic);
  }

  function saveDetails() {
    setError(null);
    startTransition(async () => {
      const response = await fetch(`/api/direct-booking/deposits/${orderId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          amount: Number(depositAmount),
          collectedVia: via || null,
          collectedOn: on || null,
          refundTo: to.trim() || null,
        }),
      }).catch(() => null);
      if (!response?.ok) return fail(((await response?.json().catch(() => null)) as { error?: string } | null)?.error);
      setMode("idle");
      router.refresh();
    });
  }

  function settle() {
    if (!validRefund || (kept > 0 && !note.trim())) return fail(validRefund ? "NOTE_REQUIRED" : "EXCEEDS_DEPOSIT");
    const confirmText = viaStripe ? copy.confirmStripe(money(refundValue), money(kept)) : copy.confirmManual(money(refundValue), money(kept));
    if (!window.confirm(confirmText)) return;
    setError(null);
    startTransition(async () => {
      const response = await fetch(
        viaStripe ? `/api/orders/${orderId}/deposit` : `/api/direct-booking/deposits/${orderId}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ refundAmount: refundValue, note: note.trim() || undefined }),
        },
      ).catch(() => null);
      if (!response?.ok) return fail(((await response?.json().catch(() => null)) as { error?: string } | null)?.error);
      setMode("idle");
      router.refresh();
    });
  }

  const field = "h-8 w-full rounded-md border border-[color:var(--line)] bg-white px-2 text-[12px]";
  const label = "block text-[11px] text-[color:var(--ink-soft)]";

  return (
    <div className="mt-2">
      {mode === "idle" ? (
        <div className="flex flex-wrap gap-2">
          {!viaStripe ? (
            <button
              type="button"
              onClick={() => setMode("edit")}
              className="rounded-md border border-[color:var(--line)] bg-white px-3 py-1.5 text-[12px] font-medium text-[color:var(--ink)]"
            >
              {copy.edit}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setMode("settle")}
            className="rounded-md bg-[var(--ink)] px-3 py-1.5 text-[12px] font-semibold text-white"
            style={{ backgroundColor: "var(--ink)", color: "#ffffff" }}
          >
            {viaStripe ? copy.settleStripe : copy.settleManual}
          </button>
        </div>
      ) : null}

      {mode === "edit" ? (
        <div className="grid gap-2 rounded-md border border-[color:var(--line)] bg-[var(--surface-muted)] p-2 sm:grid-cols-4">
          <label className="min-w-0">
            <span className={label}>{copy.amountLabel}</span>
            <input type="number" min="0" step="0.01" inputMode="decimal" value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)} className={`${field} tabular-nums`} />
          </label>
          <label className="min-w-0">
            <span className={label}>{copy.viaLabel}</span>
            <select value={via} onChange={(e) => setVia(e.target.value)} className={field}>
              <option value="">{copy.notRecorded}</option>
              {METHODS.map((method) => (
                <option key={method} value={method}>
                  {copy.via[method]}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-0">
            <span className={label}>{copy.collectedOnLabel}</span>
            <input type="date" value={on} onChange={(e) => setOn(e.target.value)} className={field} />
          </label>
          <label className="min-w-0">
            <span className={label}>{copy.refundToLabel}</span>
            <input value={to} maxLength={200} placeholder={copy.refundToPlaceholder} onChange={(e) => setTo(e.target.value)} className={field} />
          </label>
          <div className="flex gap-2 sm:col-span-4">
            <button type="button" disabled={pending} onClick={saveDetails} className="rounded-md bg-[var(--ink)] px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-60" style={{ backgroundColor: "var(--ink)", color: "#ffffff" }}>
              {copy.save}
            </button>
            <button type="button" onClick={() => setMode("idle")} className="rounded-md border border-[color:var(--line)] bg-white px-3 py-1.5 text-[12px]">
              {copy.cancel}
            </button>
          </div>
        </div>
      ) : null}

      {mode === "settle" ? (
        <div className="grid gap-2 rounded-md border border-[color:var(--line)] bg-[var(--surface-muted)] p-2 sm:grid-cols-[10rem_1fr]">
          <label className="min-w-0">
            <span className={label}>{copy.refundAmountLabel}</span>
            <input type="number" min="0" max={amount} step="0.01" inputMode="decimal" value={refund} onChange={(e) => setRefund(e.target.value)} className={`${field} tabular-nums`} />
          </label>
          <label className="min-w-0">
            <span className={label}>{copy.noteLabel}</span>
            <input value={note} maxLength={1000} disabled={kept === 0} onChange={(e) => setNote(e.target.value)} className={`${field} disabled:opacity-50`} />
          </label>
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
            <button type="button" disabled={pending} onClick={settle} className="rounded-md bg-[var(--ink)] px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-60" style={{ backgroundColor: "var(--ink)", color: "#ffffff" }}>
              {viaStripe ? copy.settleStripe.replace("…", "") : copy.settleManual.replace("…", "")}
            </button>
            <button type="button" onClick={() => setMode("idle")} className="rounded-md border border-[color:var(--line)] bg-white px-3 py-1.5 text-[12px]">
              {copy.cancel}
            </button>
            {kept > 0 ? <span className="text-[12px] text-[color:var(--ink-soft)]">{copy.kept(money(kept))}</span> : null}
          </div>
        </div>
      ) : null}

      {error ? <p className="mt-1.5 text-[12px] text-[color:var(--bad-fg)]">{error}</p> : null}
    </div>
  );
}
