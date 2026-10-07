"use client";

import { BusyLabel } from "@/components/booking-spinner";
import { useState, useTransition } from "react";

import { getMessages, type Locale } from "@/lib/i18n";

/** Approve or decline one renter request. */
export function BookingRequestActions({
  locale,
  requestId,
}: {
  locale: Locale;
  requestId: string;
}) {
  const copy = getMessages(locale).bookingRequestsPage;
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const waitCopy = getMessages(locale).waitLabels;
  // Which button was pressed, and held through the reload that follows a
  // decision: the transition ends before the page does, and a button
  // that comes back to life in between invites a second refund.
  const [deciding, setDeciding] = useState<"APPROVE" | "DECLINE" | null>(null);

  function decide(decision: "APPROVE" | "DECLINE") {
    setError(null);
    setDeciding(decision);
    startTransition(async () => {
      const response = await fetch(`/api/booking-requests/${requestId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      if (response.ok) {
        // A moved trip whose difference could not be settled is still
        // moved; say so before the page forgets the request.
        const payload = (await response.json().catch(() => null)) as {
          settlement?: { kind?: string; error?: string; amount?: number };
        } | null;
        const kind = payload?.settlement?.kind;
        if (kind === "charge_failed" || kind === "refund_failed") {
          window.alert(copy.settleFailed(payload?.settlement?.error ?? ""));
        }
        window.location.reload();
        return;
      }
      setDeciding(null);
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(
        payload?.error === "DATES_UNAVAILABLE"
          ? copy.conflictBlocked
          : payload?.error === "REFUND_FAILED"
            ? copy.refundFailed
            : copy.refundFailed,
      );
    });
  }

  return (
    <div className="mt-3">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending || deciding !== null}
          onClick={() => decide("APPROVE")}
          className="rounded-md bg-[var(--ink)] px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-60"
          style={{ backgroundColor: "var(--ink)", color: "#ffffff" }}
        >
          <BusyLabel busy={deciding === "APPROVE"} idle={copy.approveAction} working={waitCopy.approving} />
        </button>
        <button
          type="button"
          disabled={pending || deciding !== null}
          onClick={() => decide("DECLINE")}
          className="rounded-md border border-[color:var(--line-strong)] px-3 py-1.5 text-[12px] text-[color:var(--ink-mid)] disabled:opacity-60"
        >
          <BusyLabel busy={deciding === "DECLINE"} idle={copy.declineAction} working={waitCopy.declining} />
        </button>
      </div>
      {error ? (
        <p className="mt-2 text-[12px] text-[color:var(--bad-fg)]">{error}</p>
      ) : null}
    </div>
  );
}
