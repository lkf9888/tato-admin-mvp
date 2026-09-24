"use client";

import { useState, useTransition } from "react";

import { getMessages, type Locale } from "@/lib/i18n";
import { formatCurrency } from "@/lib/utils";

type Settlement = {
  settledAt: string;
  refundedAmount: number;
  note: string | null;
} | null;

/**
 * The one decision a direct booking leaves for after the trip: how much
 * of the deposit goes back.
 *
 * Defaults to all of it, since that is the common case and the one a
 * renter expects. Lowering the amount asks for a reason, because the
 * reason is emailed to the renter -- a deduction they can read is a
 * conversation; one they cannot is a chargeback.
 */
export function DepositSettlementPanel({
  locale,
  orderId,
  depositAmount,
  hasReturned,
  isCancelled,
  settlement,
}: {
  locale: Locale;
  orderId: string;
  depositAmount: number;
  hasReturned: boolean;
  isCancelled: boolean;
  settlement: Settlement;
}) {
  const copy = getMessages(locale).orderDetail;
  const money = (value: number) => formatCurrency(value, locale);
  const [refund, setRefund] = useState(depositAmount.toFixed(2));
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const refundValue = Number(refund);
  const validAmount =
    refund.trim() !== "" &&
    Number.isFinite(refundValue) &&
    refundValue >= 0 &&
    refundValue <= depositAmount + 0.001;
  const kept = validAmount ? Math.max(0, Math.round((depositAmount - refundValue) * 100) / 100) : 0;
  const needsNote = validAmount && kept > 0;
  const canSubmit = validAmount && (!needsNote || note.trim().length > 0) && !pending;

  function submit() {
    if (!canSubmit) return;
    if (!window.confirm(copy.depositConfirm(money(refundValue), money(kept)))) return;
    setError(null);
    startTransition(async () => {
      const response = await fetch(`/api/orders/${orderId}/deposit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refundAmount: refundValue, note: note.trim() || undefined }),
      });
      if (response.ok) {
        window.location.reload();
        return;
      }
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      const key = payload?.error as keyof typeof copy.depositErrors | undefined;
      setError(key && key in copy.depositErrors ? copy.depositErrors[key] : copy.depositErrors.GENERIC);
    });
  }

  return (
    <section className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-3 sm:px-4">
      <p className="t-eyebrow text-[var(--ink-soft)]">{copy.depositTitle}</p>
      <p className="mt-1 t-title tabular-nums text-[var(--ink)]">{money(depositAmount)}</p>
      <p className="mt-0.5 text-[11px] leading-4 text-[var(--ink-soft)]">
        {copy.depositHeld(money(depositAmount))}
      </p>

      {isCancelled ? (
        <p className="mt-3 border-t border-[var(--line)] pt-3 text-[12px] text-[var(--ink-soft)]">
          {copy.depositCancelled}
        </p>
      ) : settlement ? (
        <div className="mt-3 space-y-1 border-t border-[var(--line)] pt-3 text-[12.5px] leading-5">
          <p className="font-bold tabular-nums text-[var(--ink)]">
            {copy.depositRefunded(money(settlement.refundedAmount))}
            {depositAmount - settlement.refundedAmount > 0.001
              ? ` · ${copy.depositKept(money(depositAmount - settlement.refundedAmount))}`
              : ""}
          </p>
          {settlement.note ? (
            <p className="whitespace-pre-wrap text-[var(--ink)]">{settlement.note}</p>
          ) : null}
          <p className="text-[11px] text-[var(--ink-soft)]">
            {copy.depositSettledOn(
              new Date(settlement.settledAt).toLocaleDateString(
                locale === "en" ? "en-CA" : "zh-CN",
              ),
            )}
          </p>
        </div>
      ) : (
        <div className="mt-3 space-y-2 border-t border-[var(--line)] pt-3">
          {!hasReturned ? (
            <p className="text-[11.5px] leading-4 text-[var(--ink-soft)]">
              {copy.depositNotReturnedYet}
            </p>
          ) : null}
          <label className="block">
            <span className="text-[11px] font-bold text-[var(--ink-soft)]">
              {copy.depositRefundLabel}
            </span>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              max={depositAmount}
              step="0.01"
              value={refund}
              onChange={(event) => setRefund(event.target.value)}
              className="mt-1 w-full rounded-md border border-[var(--line-strong)] bg-[var(--surface)] px-2 py-1.5 text-[14px] tabular-nums text-[var(--ink)]"
            />
          </label>
          {needsNote ? (
            <label className="block">
              <span className="text-[11px] font-bold text-[var(--ink-soft)]">
                {copy.depositNoteLabel} · {copy.depositKeepHint(money(kept))}
              </span>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={3}
                maxLength={1000}
                placeholder={copy.depositNotePlaceholder}
                className="mt-1 w-full rounded-md border border-[var(--line-strong)] bg-[var(--surface)] px-2 py-1.5 text-[13px] text-[var(--ink)]"
              />
              {note.trim().length === 0 ? (
                <span className="mt-1 block text-[11px] text-[var(--ink-soft)]">
                  {copy.depositNoteRequired}
                </span>
              ) : null}
            </label>
          ) : null}
          <button
            type="button"
            disabled={!canSubmit}
            onClick={submit}
            className="w-full rounded-md px-3 py-2 text-[12px] font-bold disabled:opacity-50"
            style={{ backgroundColor: "var(--ink)", color: "#ffffff" }}
          >
            {pending ? copy.depositSubmitting : copy.depositSubmit}
          </button>
          <p className="text-[11px] leading-4 text-[var(--ink-soft)]">{copy.depositEmailNote}</p>
          {error ? <p className="text-[12px] text-[color:var(--bad-fg)]">{error}</p> : null}
        </div>
      )}
    </section>
  );
}
