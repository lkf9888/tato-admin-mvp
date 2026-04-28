"use client";

import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";

import {
  expandBlockedBookingDates,
  getDirectBookingQuote,
  hasDateOnlyBookingConflict,
  type DateOnlyBookingWindow,
} from "@/lib/direct-booking";
import { getLocaleTag, getMessages, type Locale } from "@/lib/i18n";
import { cn, formatCurrency } from "@/lib/utils";

type CheckoutState = "idle" | "success" | "cancelled" | "error";

type StoredBookingState = {
  pickupDate: string;
  returnDate: string;
  renterName: string;
  renterEmail: string;
  renterPhone: string;
  includeInsurance: boolean;
};

type BookingDatePickerProps = {
  locale: Locale;
  label: string;
  hint: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  isDateDisabled: (value: string) => boolean;
  minDate?: string;
  disabled?: boolean;
};

const STORAGE_PREFIX = "tato-direct-booking:";
const DAY_MS = 86_400_000;
const WEEKDAY_LABELS = {
  en: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
  zh: ["一", "二", "三", "四", "五", "六", "日"],
} as const;

function parseDateOnly(value: string) {
  const [year, month, day] = value.split("-").map(Number);

  if (!year || !month || !day) {
    return null;
  }

  return new Date(Date.UTC(year, month - 1, day, 12));
}

function formatDateOnlyValue(value: Date) {
  return value.toISOString().slice(0, 10);
}

function addUtcDays(value: Date, amount: number) {
  return new Date(value.getTime() + amount * DAY_MS);
}

function startOfUtcMonth(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1, 12));
}

function buildCalendarDays(monthValue: Date) {
  const monthStart = startOfUtcMonth(monthValue);
  const mondayOffset = (monthStart.getUTCDay() + 6) % 7;
  const gridStart = addUtcDays(monthStart, -mondayOffset);

  return Array.from({ length: 42 }, (_, index) => addUtcDays(gridStart, index));
}

function formatDisplayDate(value: string, locale: Locale) {
  const parsed = parseDateOnly(value);
  if (!parsed) return value;

  return new Intl.DateTimeFormat(getLocaleTag(locale), {
    month: locale === "zh" ? "numeric" : "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}

function formatMonthLabel(value: Date, locale: Locale) {
  return new Intl.DateTimeFormat(getLocaleTag(locale), {
    month: locale === "zh" ? "long" : "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(value);
}

function BookingDatePicker({
  locale,
  label,
  hint,
  value,
  placeholder,
  onChange,
  isDateDisabled,
  minDate,
  disabled = false,
}: BookingDatePickerProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const initialMonth = useMemo(() => {
    const seededValue = value || minDate || formatDateOnlyValue(new Date());
    return startOfUtcMonth(parseDateOnly(seededValue) ?? new Date());
  }, [minDate, value]);

  const [isOpen, setIsOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(initialMonth);

  useEffect(() => {
    if (!value) return;

    const parsed = parseDateOnly(value);
    if (parsed) {
      setVisibleMonth(startOfUtcMonth(parsed));
    }
  }, [value]);

  useEffect(() => {
    if (!isOpen) return;

    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [isOpen]);

  const days = useMemo(() => buildCalendarDays(visibleMonth), [visibleMonth]);
  const weekdayLabels = WEEKDAY_LABELS[locale];

  return (
    <div className="relative" ref={rootRef}>
      <span className="mb-2 block text-sm font-medium text-white">{label}</span>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen((current) => !current)}
        className={cn(
          "flex w-full items-center justify-between rounded-md border border-white/10 bg-white/6 px-4 py-3 text-left text-sm text-white transition",
          disabled ? "cursor-not-allowed opacity-50" : "hover:border-white/20",
        )}
      >
        <span className={cn(value ? "text-white" : "text-white/46")}>
          {value ? formatDisplayDate(value, locale) : placeholder}
        </span>
        <CalendarDays className="h-4 w-4 text-white/54" />
      </button>
      <p className="mt-2 text-xs leading-5 text-white/48">{hint}</p>

      {isOpen ? (
        <div className="absolute left-0 z-30 mt-3 w-[19rem] rounded-lg border border-white/10 bg-[#0f131b] p-4 shadow-[0_30px_70px_-30px_rgba(0,0,0,0.85)]">
          <div className="mb-4 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setVisibleMonth((current) => addUtcDays(startOfUtcMonth(current), -1))}
              className="rounded-full border border-white/10 p-2 text-white/70 transition hover:border-white/20 hover:text-white"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <p className="text-sm font-medium text-white">{formatMonthLabel(visibleMonth, locale)}</p>
            <button
              type="button"
              onClick={() => setVisibleMonth((current) => addUtcDays(startOfUtcMonth(current), 35))}
              className="rounded-full border border-white/10 p-2 text-white/70 transition hover:border-white/20 hover:text-white"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center text-[11px] uppercase tracking-[0.18em] text-white/38">
            {weekdayLabels.map((weekday) => (
              <span key={weekday} className="py-1">
                {weekday}
              </span>
            ))}
          </div>

          <div className="mt-2 grid grid-cols-7 gap-1">
            {days.map((day) => {
              const dayValue = formatDateOnlyValue(day);
              const isDisabled = disabled || isDateDisabled(dayValue);
              const isSelected = value === dayValue;
              const isOutsideMonth = day.getUTCMonth() !== visibleMonth.getUTCMonth();

              return (
                <button
                  key={dayValue}
                  type="button"
                  disabled={isDisabled}
                  onClick={() => {
                    onChange(dayValue);
                    setIsOpen(false);
                  }}
                  className={cn(
                    "h-10 rounded-xl text-sm transition",
                    isSelected
                      ? "bg-[#593cfb] text-white shadow-[0_16px_30px_-18px_rgba(89, 60, 251, 0.95)]"
                      : "text-white/88",
                    isOutsideMonth && !isSelected ? "text-white/28" : "",
                    !isDisabled && !isSelected ? "hover:bg-white/8" : "",
                    isDisabled ? "cursor-not-allowed text-white/18 line-through opacity-60" : "",
                  )}
                >
                  {day.getUTCDate()}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function PublicBookingPanel({
  locale,
  vehicleId,
  bookingDailyRate,
  bookingInsuranceFee,
  bookingDepositAmount,
  blockedDateWindows,
  stripeReady,
  hostPayoutsReady,
  defaultPickupDate,
  defaultReturnDate,
  checkoutState,
}: {
  locale: Locale;
  vehicleId: string;
  bookingDailyRate: number;
  bookingInsuranceFee: number;
  bookingDepositAmount: number;
  blockedDateWindows: DateOnlyBookingWindow[];
  stripeReady: boolean;
  hostPayoutsReady: boolean;
  defaultPickupDate: string;
  defaultReturnDate: string;
  checkoutState: CheckoutState;
}) {
  const messages = getMessages(locale);
  const reserveMessages = messages.reservePage;
  const storageKey = `${STORAGE_PREFIX}${vehicleId}`;
  const todayDate = useMemo(() => formatDateOnlyValue(new Date()), []);
  const blockedDateSet = useMemo(
    () => expandBlockedBookingDates(blockedDateWindows),
    [blockedDateWindows],
  );

  const [pickupDate, setPickupDate] = useState(defaultPickupDate);
  const [returnDate, setReturnDate] = useState(defaultReturnDate);
  const [renterName, setRenterName] = useState("");
  const [renterEmail, setRenterEmail] = useState("");
  const [renterPhone, setRenterPhone] = useState("");
  const [includeInsurance, setIncludeInsurance] = useState(bookingInsuranceFee > 0);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  const isPickupDateDisabled = useCallback(
    (candidate: string) => {
      if (candidate < todayDate) return true;
      if (blockedDateSet.has(candidate)) return true;
      if (returnDate && candidate >= returnDate) return true;
      if (returnDate && hasDateOnlyBookingConflict(blockedDateWindows, candidate, returnDate)) {
        return true;
      }

      return false;
    },
    [blockedDateSet, blockedDateWindows, returnDate, todayDate],
  );

  const isReturnDateDisabled = useCallback(
    (candidate: string) => {
      if (!pickupDate) return true;
      if (candidate <= pickupDate) return true;

      return hasDateOnlyBookingConflict(blockedDateWindows, pickupDate, candidate);
    },
    [blockedDateWindows, pickupDate],
  );

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
    if (pickupDate && isPickupDateDisabled(pickupDate)) {
      setPickupDate("");
      setReturnDate("");
      setError(reserveMessages.conflictError);
      return;
    }

    if (returnDate && isReturnDateDisabled(returnDate)) {
      setReturnDate("");
      setError(reserveMessages.conflictError);
    }
  }, [
    isPickupDateDisabled,
    isReturnDateDisabled,
    pickupDate,
    reserveMessages.conflictError,
    returnDate,
  ]);

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

  function handlePickupDateChange(nextValue: string) {
    setError("");
    setPickupDate(nextValue);

    if (returnDate && hasDateOnlyBookingConflict(blockedDateWindows, nextValue, returnDate)) {
      setReturnDate("");
    }
  }

  function handleReturnDateChange(nextValue: string) {
    setError("");
    setReturnDate(nextValue);
  }

  async function startCheckout() {
    setError("");

    if (!pickupDate || !returnDate || quote.days < 1) {
      setError(reserveMessages.invalidRange);
      return;
    }

    if (hasDateOnlyBookingConflict(blockedDateWindows, pickupDate, returnDate)) {
      setError(reserveMessages.conflictError);
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
    <div className="rounded-lg border border-white/10 bg-[#10141d] p-5 text-white shadow-[0_35px_80px_-50px_rgba(5,8,14,0.95)] sm:p-6">
      <p className="text-[11px] uppercase tracking-[0.32em] text-white/48">
        {reserveMessages.bookingPanelTitle}
      </p>
      <p className="mt-3 max-w-lg text-sm leading-6 text-white/68">{reserveMessages.bookingPanelCopy}</p>

      {checkoutState === "success" ? (
        <div className="mt-5 rounded-lg border border-emerald-300/18 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100">
          {reserveMessages.successNotice}
        </div>
      ) : null}

      {checkoutState === "cancelled" ? (
        <div className="mt-5 rounded-lg border border-amber-300/18 bg-amber-400/10 px-4 py-3 text-sm text-amber-50">
          {reserveMessages.cancelledNotice}
        </div>
      ) : null}

      {checkoutState === "error" ? (
        <div className="mt-5 rounded-lg border border-rose-300/18 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
          {reserveMessages.errorNotice}
        </div>
      ) : null}

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <BookingDatePicker
          locale={locale}
          label={reserveMessages.pickupDate}
          hint={reserveMessages.pickupDateHint}
          value={pickupDate}
          placeholder={reserveMessages.selectDatePlaceholder}
          onChange={handlePickupDateChange}
          isDateDisabled={isPickupDateDisabled}
          minDate={todayDate}
        />
        <BookingDatePicker
          locale={locale}
          label={reserveMessages.returnDate}
          hint={reserveMessages.returnDateHint}
          value={returnDate}
          placeholder={reserveMessages.selectDatePlaceholder}
          onChange={handleReturnDateChange}
          isDateDisabled={isReturnDateDisabled}
          minDate={pickupDate}
          disabled={!pickupDate}
        />
      </div>

      <div className="mt-3 rounded-md border border-white/8 bg-white/[0.03] px-4 py-3 text-xs leading-5 text-white/54">
        {reserveMessages.calendarHint}
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-white">{reserveMessages.renterName}</span>
          <input
            value={renterName}
            onChange={(event) => setRenterName(event.target.value)}
            className="w-full rounded-md border border-white/10 bg-white/6 px-4 py-3 text-sm text-white"
          />
        </label>
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-white">{reserveMessages.renterEmail}</span>
          <input
            type="email"
            value={renterEmail}
            onChange={(event) => setRenterEmail(event.target.value)}
            className="w-full rounded-md border border-white/10 bg-white/6 px-4 py-3 text-sm text-white"
          />
        </label>
      </div>

      <label className="mt-4 block">
        <span className="mb-2 block text-sm font-medium text-white">{reserveMessages.renterPhone}</span>
        <input
          value={renterPhone}
          onChange={(event) => setRenterPhone(event.target.value)}
          className="w-full rounded-md border border-white/10 bg-white/6 px-4 py-3 text-sm text-white"
        />
      </label>

      <label className="mt-5 flex items-start gap-3 rounded-md border border-white/8 bg-white/[0.04] px-4 py-4">
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

      <div className="mt-5 rounded-lg border border-white/8 bg-white/[0.04] p-4">
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

      <div className="mt-4 flex items-center justify-between rounded-md border border-white/8 bg-white/[0.04] px-4 py-3">
        <div>
          <p className="text-sm font-medium text-white">
            {!stripeReady
              ? reserveMessages.stripeMissing
              : !hostPayoutsReady
                ? reserveMessages.hostPayoutsMissing
                : reserveMessages.stripeReady}
          </p>
          <p className="mt-1 text-xs text-white/56">
            {!hostPayoutsReady && stripeReady
              ? reserveMessages.hostPayoutsHint
              : reserveMessages.checkoutHelp}
          </p>
        </div>
      </div>

      {error ? (
        <div className="mt-4 rounded-lg border border-rose-300/18 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
          {error}
        </div>
      ) : null}

      <button
        onClick={startCheckout}
        disabled={!stripeReady || !hostPayoutsReady || isPending}
        className="mt-5 w-full rounded-full bg-[#593cfb] px-4 py-3.5 text-sm font-semibold text-white shadow-[0_18px_40px_-24px_rgba(89, 60, 251, 0.9)] transition hover:translate-y-[-1px] disabled:cursor-not-allowed disabled:opacity-60"
        style={{ backgroundColor: "#593cfb", color: "#ffffff" }}
      >
        {isPending ? reserveMessages.checkoutLoading : reserveMessages.checkoutAction}
      </button>
    </div>
  );
}
