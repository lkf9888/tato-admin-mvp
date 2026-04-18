"use client";

import { useEffect, useMemo, useState, useTransition } from "react";

import { getDirectBookingQuote } from "@/lib/direct-booking";
import { getMessages, type Locale } from "@/lib/i18n";
import { formatCurrency } from "@/lib/utils";

type CheckoutState = "idle" | "success" | "cancelled" | "error";

type StoredBookingState = {
  pickupDate: string;
  returnDate: string;
  renterName: string;
  renterEmail: string;
  renterPhone: string;
  includeInsurance: boolean;
};

const STORAGE_PREFIX = "tato-direct-booking:";

export function PublicBookingPanel({
  locale,
  vehicleId,
  bookingDailyRate,
  bookingInsuranceFee,
  bookingDepositAmount,
  stripeReady,
  defaultPickupDate,
  defaultReturnDate,
  checkoutState,
}: {
  locale: Locale;
  vehicleId: string;
  bookingDailyRate: number;
  bookingInsuranceFee: number;
  bookingDepositAmount: number;
  stripeReady: boolean;
  defaultPickupDate: string;
  defaultReturnDate: string;
  checkoutState: CheckoutState;
}) {
  const messages = getMessages(locale);
  const reserveMessages = messages.reservePage;
  const storageKey = `${STORAGE_PREFIX}${vehicleId}`;

  const [pickupDate, setPickupDate] = useState(defaultPickupDate);
  const [returnDate, setReturnDate] = useState(defaultReturnDate);
  const [renterName, setRenterName] = useState("");
  const [renterEmail, setRenterEmail] = useState("");
  const [renterPhone, setRenterPhone] = useState("");
  const [includeInsurance, setIncludeInsurance] = useState(bookingInsuranceFee > 0);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const stored = window.sessionStorage.getItem(storageKey);
    if (!stored) return;

    try {
      const parsed = JSON.parse(stored) as StoredBookingState;
      setPickupDate(parsed.pickupDate || defaultPickupDate);
      setReturnDate(parsed.returnDate || defaultReturnDate);
      setRenterName(parsed.renterName || "");
      setRenterEmail(parsed.renterEmail || "");
      setRenterPhone(parsed.renterPhone || "");
      setIncludeInsurance(Boolean(parsed.includeInsurance));
    } catch {
      window.sessionStorage.removeItem(storageKey);
    }
  }, [defaultPickupDate, defaultReturnDate, storageKey]);

  useEffect(() => {
    const payload: StoredBookingState = {
      pickupDate,
      returnDate,
      renterName,
      renterEmail,
      renterPhone,
      includeInsurance,
    };

    window.sessionStorage.setItem(storageKey, JSON.stringify(payload));
  }, [includeInsurance, pickupDate, renterEmail, renterName, renterPhone, returnDate, storageKey]);

  const quote = useMemo(
    () =>
      getDirectBookingQuote({
        pickupDate,
        returnDate,
        bookingDailyRate,
        bookingInsuranceFee,
        bookingDepositAmount,
        includeInsurance,
      }),
    [
      bookingDailyRate,
      bookingDepositAmount,
      bookingInsuranceFee,
      includeInsurance,
      pickupDate,
      returnDate,
    ],
  );

  async function startCheckout() {
    setError("");

    if (!pickupDate || !returnDate || quote.days < 1) {
      setError(reserveMessages.invalidRange);
      return;
    }

    if (!renterName.trim() || !renterEmail.trim()) {
      setError(reserveMessages.missingFields);
      return;
    }

    startTransition(async () => {
      const response = await fetch("/api/direct-booking/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          vehicleId,
          pickupDate,
          returnDate,
          renterName,
          renterEmail,
          renterPhone,
          includeInsurance,
        }),
      });

      const payload = (await response.json()) as { error?: string; url?: string };
      if (!response.ok || !payload.url) {
        setError(payload.error ?? reserveMessages.genericCheckoutError);
        return;
      }

      window.location.href = payload.url;
    });
  }

  return (
    <div className="rounded-[2rem] border border-white/10 bg-[#10141d] p-5 text-white shadow-[0_35px_80px_-50px_rgba(5,8,14,0.95)] sm:p-6">
      <p className="text-[11px] uppercase tracking-[0.32em] text-white/48">
        {reserveMessages.bookingPanelTitle}
      </p>
      <p className="mt-3 max-w-lg text-sm leading-6 text-white/68">{reserveMessages.bookingPanelCopy}</p>

      {checkoutState === "success" ? (
        <div className="mt-5 rounded-[1.5rem] border border-emerald-300/18 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100">
          {reserveMessages.successNotice}
        </div>
      ) : null}

      {checkoutState === "cancelled" ? (
        <div className="mt-5 rounded-[1.5rem] border border-amber-300/18 bg-amber-400/10 px-4 py-3 text-sm text-amber-50">
          {reserveMessages.cancelledNotice}
        </div>
      ) : null}

      {checkoutState === "error" ? (
        <div className="mt-5 rounded-[1.5rem] border border-rose-300/18 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
          {reserveMessages.errorNotice}
        </div>
      ) : null}

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-white">{reserveMessages.pickupDate}</span>
          <input
            type="date"
            value={pickupDate}
            onChange={(event) => setPickupDate(event.target.value)}
            className="w-full rounded-[1.2rem] border border-white/10 bg-white/6 px-4 py-3 text-sm text-white"
          />
        </label>
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-white">{reserveMessages.returnDate}</span>
          <input
            type="date"
            value={returnDate}
            min={pickupDate || undefined}
            onChange={(event) => setReturnDate(event.target.value)}
            className="w-full rounded-[1.2rem] border border-white/10 bg-white/6 px-4 py-3 text-sm text-white"
          />
        </label>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-white">{reserveMessages.renterName}</span>
          <input
            value={renterName}
            onChange={(event) => setRenterName(event.target.value)}
            className="w-full rounded-[1.2rem] border border-white/10 bg-white/6 px-4 py-3 text-sm text-white"
          />
        </label>
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-white">{reserveMessages.renterEmail}</span>
          <input
            type="email"
            value={renterEmail}
            onChange={(event) => setRenterEmail(event.target.value)}
            className="w-full rounded-[1.2rem] border border-white/10 bg-white/6 px-4 py-3 text-sm text-white"
          />
        </label>
      </div>

      <label className="mt-4 block">
        <span className="mb-2 block text-sm font-medium text-white">{reserveMessages.renterPhone}</span>
        <input
          value={renterPhone}
          onChange={(event) => setRenterPhone(event.target.value)}
          className="w-full rounded-[1.2rem] border border-white/10 bg-white/6 px-4 py-3 text-sm text-white"
        />
      </label>

      <label className="mt-5 flex items-start gap-3 rounded-[1.3rem] border border-white/8 bg-white/[0.04] px-4 py-4">
        <input
          type="checkbox"
          checked={includeInsurance}
          onChange={(event) => setIncludeInsurance(event.target.checked)}
          className="mt-1 h-4 w-4 rounded border-white/20"
        />
        <span className="block">
          <span className="block text-sm font-medium text-white">{reserveMessages.insuranceToggle}</span>
          <span className="mt-1 block text-xs leading-5 text-white/58">
            {reserveMessages.insuranceToggleHint}
          </span>
        </span>
      </label>

      <div className="mt-5 rounded-[1.5rem] border border-white/8 bg-white/[0.04] p-4">
        <div className="flex items-center justify-between text-sm text-white/62">
          <span>{reserveMessages.quoteDays(quote.days)}</span>
          <span>{formatCurrency(bookingDailyRate, locale)}</span>
        </div>
        <div className="mt-4 space-y-3 text-sm text-white/72">
          <div className="flex items-center justify-between">
            <span>{reserveMessages.quoteBase}</span>
            <span>{formatCurrency(quote.baseAmount, locale)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>{reserveMessages.quoteInsurance}</span>
            <span>{includeInsurance ? formatCurrency(quote.insuranceAmount, locale) : "—"}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>{reserveMessages.quoteDeposit}</span>
            <span>{formatCurrency(quote.depositAmount, locale)}</span>
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-4">
          <span className="text-sm font-medium text-white">{reserveMessages.quoteTotal}</span>
          <span className="text-[1.6rem] font-semibold text-white">
            {formatCurrency(quote.totalAmount, locale)}
          </span>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between rounded-[1.3rem] border border-white/8 bg-white/[0.04] px-4 py-3">
        <div>
          <p className="text-sm font-medium text-white">
            {stripeReady ? reserveMessages.stripeReady : reserveMessages.stripeMissing}
          </p>
          <p className="mt-1 text-xs text-white/56">{reserveMessages.checkoutHelp}</p>
        </div>
      </div>

      {error ? (
        <div className="mt-4 rounded-[1.4rem] border border-rose-300/18 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
          {error}
        </div>
      ) : null}

      <button
        onClick={startCheckout}
        disabled={!stripeReady || isPending}
        className="mt-5 w-full rounded-full bg-[#ff6b57] px-4 py-3.5 text-sm font-semibold text-white shadow-[0_18px_40px_-24px_rgba(255,107,87,0.9)] transition hover:translate-y-[-1px] disabled:cursor-not-allowed disabled:opacity-60"
        style={{ backgroundColor: "#ff6b57", color: "#ffffff" }}
      >
        {isPending ? reserveMessages.checkoutLoading : reserveMessages.checkoutAction}
      </button>
    </div>
  );
}
