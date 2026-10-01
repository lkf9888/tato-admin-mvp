"use client";

import { useEffect, useState, useTransition } from "react";

import { BOOKING_TIME_OPTIONS, zonedDateTimeToUtc } from "@/lib/booking-time";
import { getMessages, type Locale } from "@/lib/i18n";
import { formatCurrency } from "@/lib/utils";

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
  defaultPickupTime,
  defaultReturnTime,
}: {
  locale: Locale;
  token: string;
  canRequest: boolean;
  cancelOutcome: "free" | "late" | "started";
  cancelCopy: string;
  minDate: string;
  defaultPickupDate: string;
  defaultReturnDate: string;
  /** `HH:MM`, the trip's current times, on the operator's clock. */
  defaultPickupTime: string;
  defaultReturnTime: string;
}) {
  const copy = getMessages(locale).bookingPage;
  const [pickupDate, setPickupDate] = useState(defaultPickupDate);
  const [returnDate, setReturnDate] = useState(defaultReturnDate);
  const [pickupTime, setPickupTime] = useState(defaultPickupTime);
  const [returnTime, setReturnTime] = useState(defaultReturnTime);
  // What these dates would cost or return, asked of the server as the
  // renter picks them, so the request they send already states it.
  const [priceQuote, setPriceQuote] = useState<{ difference: number; settlement: number; late: boolean } | null>(null);
  const changed =
    pickupDate !== defaultPickupDate ||
    returnDate !== defaultReturnDate ||
    pickupTime !== defaultPickupTime ||
    returnTime !== defaultReturnTime;
  useEffect(() => {
    setPriceQuote(null);
    if (!changed) return;
    const timer = window.setTimeout(async () => {
      const response = await fetch(`/api/booking/${token}/reschedule-quote`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pickupDate, returnDate, pickupTime, returnTime }),
      }).catch(() => null);
      if (response?.ok) setPriceQuote(await response.json());
    }, 400);
    return () => window.clearTimeout(timer);
  }, [changed, token, pickupDate, returnDate, pickupTime, returnTime]);
  const money = (value: number) => formatCurrency(Math.abs(value), locale);
  const priceNote = !priceQuote
    ? null
    : priceQuote.difference === 0
      ? copy.reschedulePriceSame
      : priceQuote.difference > 0
        ? copy.reschedulePriceMore(money(priceQuote.difference))
        : priceQuote.settlement < 0
          ? copy.reschedulePriceLess(money(priceQuote.difference))
          : copy.reschedulePriceLessLate(money(priceQuote.difference));
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(kind: "CANCEL" | "RESCHEDULE") {
    setError(null);

    const pickupAt = zonedDateTimeToUtc(pickupDate, pickupTime);
    const returnAt = zonedDateTimeToUtc(returnDate, returnTime);
    if (kind === "RESCHEDULE" && !(pickupAt && returnAt && returnAt > pickupAt)) {
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
          ...(kind === "RESCHEDULE" ? { pickupDate, returnDate, pickupTime, returnTime } : {}),
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
          : payload?.error === "TOO_SOON"
            ? copy.rescheduleTooSoon
            : payload?.error === "INVALID_RANGE"
            ? copy.invalidRange
            : payload?.error === "ALREADY_STARTED"
              ? copy.cancelStartedCopy
              : copy.submitError,
      );
    });
  }

  if (!canRequest) return null;

  const field_ =
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
        <div className="mt-3 grid grid-cols-2 gap-3">
          {(
            [
              { label: copy.newPickupLabel, timeLabel: copy.newPickupTimeLabel, date: pickupDate, setDate: setPickupDate, time: pickupTime, setTime: setPickupTime, min: minDate },
              { label: copy.newReturnLabel, timeLabel: copy.newReturnTimeLabel, date: returnDate, setDate: setReturnDate, time: returnTime, setTime: setReturnTime, min: pickupDate || minDate },
            ] as const
          ).map((field) => (
            <div key={field.label} className="min-w-0 space-y-2">
              <label className="block">
                <span className="text-[12px] font-medium text-[var(--ink-mid)]">{field.label}</span>
                <input
                  type="date"
                  min={field.min}
                  value={field.date}
                  onChange={(event) => field.setDate(event.target.value)}
                  className={field_}
                />
              </label>
              <label className="block">
                <span className="text-[12px] font-medium text-[var(--ink-mid)]">{field.timeLabel}</span>
                <select
                  value={field.time}
                  onChange={(event) => field.setTime(event.target.value)}
                  className={field_}
                >
                  {BOOKING_TIME_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[12px] text-[var(--ink-soft)]">{copy.timeZoneNote}</p>
        {priceNote ? (
          <p className="mt-3 rounded-md bg-[var(--surface-muted)] px-3 py-2 text-[13px] leading-5 text-[var(--ink)]">
            {priceNote}
          </p>
        ) : null}
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
