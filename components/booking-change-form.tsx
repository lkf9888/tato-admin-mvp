"use client";

import { useState, useTransition } from "react";

import { getMessages, type Locale } from "@/lib/i18n";

/**
 * The renter's cancel / reschedule form.
 *
 * Submits a request and reloads; there is no optimistic state, because
 * what comes back from the server is the only thing that decides
 * whether the host now has a request to answer.
 */
export function BookingChangeForm({
  locale,
  token,
  canRequest,
  cancelOutcome,
  cancelCopy,
  minDate,
  defaultPickupDate,
  defaultReturnDate,
}: {
  locale: Locale;
  token: string;
  canRequest: boolean;
  cancelOutcome: "free" | "late" | "started";
  cancelCopy: string;
  minDate: string;
  defaultPickupDate: string;
  defaultReturnDate: string;
}) {
  const copy = getMessages(locale).bookingPage;
  const [pickupDate, setPickupDate] = useState(defaultPickupDate);
  const [returnDate, setReturnDate] = useState(defaultReturnDate);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(kind: "CANCEL" | "RESCHEDULE") {
    setError(null);

    if (kind === "RESCHEDULE" && !(returnDate > pickupDate)) {
      setError(copy.invalidRange);
      return;
    }
    if (kind === "CANCEL" && !window.confirm(copy.cancelConfirm)) return;

    startTransition(async () => {
      const response = await fetch(`/api/booking/${token}/request`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind,
          note: note || undefined,
          ...(kind === "RESCHEDULE" ? { pickupDate, returnDate } : {}),
        }),
      });

      if (response.ok) {
        window.location.reload();
        return;
      }

      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(
        payload?.error === "DATES_UNAVAILABLE"
          ? copy.rescheduleUnavailable
          : payload?.error === "INVALID_RANGE"
            ? copy.invalidRange
            : payload?.error === "ALREADY_STARTED"
              ? copy.cancelStartedCopy
              : copy.submitError,
      );
    });
  }

  if (!canRequest) return null;

  const field =
    "mt-1 h-11 w-full rounded-[var(--control-radius)] border border-[var(--line-strong)] bg-white px-3 text-sm text-[var(--ink)]";

  return (
    <section className="mt-6 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-5">
      <h2 className="text-lg font-semibold text-[var(--ink)]">{copy.changeTitle}</h2>
      <p className="mt-1 text-[13px] text-[var(--ink-soft)]">{copy.changeCopy}</p>

      {error ? (
        <p className="mt-4 rounded-md border border-[color:var(--bad-fg)]/20 bg-[var(--bad-bg)] px-3 py-2 text-[13px] text-[color:var(--bad-fg)]">
          {error}
        </p>
      ) : null}

      <div className="mt-5 border-t border-[var(--line)] pt-5">
        <h3 className="text-sm font-semibold text-[var(--ink)]">{copy.rescheduleHeading}</h3>
        <p className="mt-1 text-[13px] text-[var(--ink-soft)]">{copy.rescheduleCopy}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-[12px] font-medium text-[var(--ink-mid)]">
              {copy.newPickupLabel}
            </span>
            <input
              type="date"
              min={minDate}
              value={pickupDate}
              onChange={(event) => setPickupDate(event.target.value)}
              className={field}
            />
          </label>
          <label className="block">
            <span className="text-[12px] font-medium text-[var(--ink-mid)]">
              {copy.newReturnLabel}
            </span>
            <input
              type="date"
              min={pickupDate || minDate}
              value={returnDate}
              onChange={(event) => setReturnDate(event.target.value)}
              className={field}
            />
          </label>
        </div>
      </div>

      <label className="mt-4 block">
        <span className="text-[12px] font-medium text-[var(--ink-mid)]">{copy.noteLabel}</span>
        <textarea
          rows={3}
          value={note}
          placeholder={copy.notePlaceholder}
          onChange={(event) => setNote(event.target.value)}
          maxLength={1000}
          className="mt-1 w-full rounded-[var(--control-radius)] border border-[var(--line-strong)] bg-white px-3 py-2 text-sm text-[var(--ink)]"
        />
      </label>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => submit("RESCHEDULE")}
          className="h-11 rounded-[var(--control-radius)] bg-[var(--brand)] px-5 text-sm font-semibold text-white disabled:opacity-60"
        >
          {copy.rescheduleAction}
        </button>
      </div>

      <div className="mt-6 border-t border-[var(--line)] pt-5">
        <h3 className="text-sm font-semibold text-[var(--ink)]">{copy.cancelHeading}</h3>
        <p className="mt-1 text-[13px] leading-6 text-[var(--ink-soft)]">{cancelCopy}</p>
        {cancelOutcome !== "started" ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => submit("CANCEL")}
            className="mt-3 h-11 rounded-[var(--control-radius)] border border-[color:var(--bad-fg)]/30 px-5 text-sm font-semibold text-[color:var(--bad-fg)] disabled:opacity-60"
          >
            {copy.cancelAction}
          </button>
        ) : null}
      </div>
    </section>
  );
}
