"use client";

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

  function decide(decision: "APPROVE" | "DECLINE") {
    setError(null);
    startTransition(async () => {
      const response = await fetch(`/api/booking-requests/${requestId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      if (response.ok) {
        window.location.reload();
        return;
      }
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
          disabled={pending}
          onClick={() => decide("APPROVE")}
          className="rounded-md bg-[var(--ink)] px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-60"
          style={{ backgroundColor: "var(--ink)", color: "#ffffff" }}
        >
          {copy.approveAction}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => decide("DECLINE")}
          className="rounded-md border border-[color:var(--line-strong)] px-3 py-1.5 text-[12px] text-[color:var(--ink-mid)] disabled:opacity-60"
        >
          {copy.declineAction}
        </button>
      </div>
      {error ? (
        <p className="mt-2 text-[12px] text-[color:var(--bad-fg)]">{error}</p>
      ) : null}
    </div>
  );
}
