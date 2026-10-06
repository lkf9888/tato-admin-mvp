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
  earliestPickupAt,
  expandBlockedBookingDates,
  getDirectBookingInstalmentPlan,
  getDirectBookingQuote,
  hasBusyWindowConflict,
  hasDateOnlyBookingConflict,
  padTripWindow,
  type BusyWindow,
  type DateOnlyBookingWindow,
} from "@/lib/direct-booking";
import { renterDailyPrice, type TaxLine } from "@/lib/booking-policy";
import { normalizeCouponCode, type CouponDiscount } from "@/lib/booking-coupons";
import { SignaturePad } from "@/components/signature-pad";
import type { BookingAddOnOption } from "@/lib/booking-add-ons";
import {
  BOOKING_TIME_OPTIONS,
  DEFAULT_BOOKING_TIME,
  isBookingTime,
  utcToZonedDate,
  zonedDateTimeToUtc,
} from "@/lib/booking-time";
import { DEFAULT_CANCELLATION_POLICY, type CancellationPolicyKey } from "@/lib/booking-changes";
import { getLocaleTag, getMessages, type Locale } from "@/lib/i18n";
import { cn, formatCurrency } from "@/lib/utils";

type CheckoutState = "idle" | "success" | "cancelled" | "error";

type StoredBookingState = {
  hasLocalLicence?: "yes" | "no" | "";
  pickupTime?: string;
  returnTime?: string;
  pickupDate: string;
  returnDate: string;
  renterName?: string;
  renterFirstName?: string;
  renterLastName?: string;
  renterEmail: string;
  renterPhone: string;
  agreementAccepted: boolean;
  addOnIds?: string[];
};

type BookingDatePickerProps = {
  locale: Locale;
  label: string;
  /** Which edge the month popup hangs from; the right-hand picker opens leftward so it stays on screen. */
  align?: "left" | "right";
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  isDateDisabled: (value: string) => boolean;
  minDate?: string;
  disabled?: boolean;
};

const STORAGE_PREFIX = "tato-direct-booking:";
const DAY_MS = 86_400_000;
const WEEKDAY_LABELS: Record<Locale, readonly string[]> = {
  en: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
  zh: ["一", "二", "三", "四", "五", "六", "日"],
  "zh-Hant": ["一", "二", "三", "四", "五", "六", "日"],
};

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

/** Today on the renter's own calendar. `toISOString` is UTC, which in
 *  Vancouver turns into tomorrow at 5 pm and made today unbookable. */
function localTodayValue() {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
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
  align = "left",
  value,
  placeholder,
  onChange,
  isDateDisabled,
  minDate,
  disabled = false,
}: BookingDatePickerProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const initialMonth = useMemo(() => {
    const seededValue = value || minDate || localTodayValue();
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
      <span className="mb-1 block text-xs font-medium text-[var(--ink)] sm:mb-2 sm:text-sm">{label}</span>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen((current) => !current)}
        className={cn(
          "flex w-full items-center justify-between rounded-md border border-[var(--line)] bg-white px-3 py-2 text-left text-sm text-[var(--ink)] transition sm:px-4 sm:py-3",
          disabled ? "cursor-not-allowed opacity-50" : "hover:border-[var(--line-strong)]",
        )}
      >
        <span className={cn(value ? "text-[var(--ink)]" : "text-[var(--ink-soft)]")}>
          {value ? formatDisplayDate(value, locale) : placeholder}
        </span>
        <CalendarDays className="h-4 w-4 text-[var(--ink-soft)]" />
      </button>

      {isOpen ? (
        <div
          className={cn(
            "absolute z-30 mt-2 w-[19rem] max-w-[calc(100vw-2rem)] rounded-lg border border-[var(--line)] bg-white p-4 shadow-[0_30px_70px_-40px_rgba(15,23,42,0.55)]",
            align === "right" ? "right-0" : "left-0",
          )}
        >
          <div className="mb-4 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setVisibleMonth((current) => addUtcDays(startOfUtcMonth(current), -1))}
              className="rounded-md border border-[var(--line)] p-2 text-[var(--ink-mid)] transition hover:border-[var(--line-strong)] hover:text-[var(--ink)]"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <p className="text-sm font-medium text-[var(--ink)]">{formatMonthLabel(visibleMonth, locale)}</p>
            <button
              type="button"
              onClick={() => setVisibleMonth((current) => addUtcDays(startOfUtcMonth(current), 35))}
              className="rounded-md border border-[var(--line)] p-2 text-[var(--ink-mid)] transition hover:border-[var(--line-strong)] hover:text-[var(--ink)]"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center text-[11px] uppercase tracking-[0.18em] text-[var(--ink-soft)]">
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
                    "h-10 rounded-md text-sm transition",
                    isSelected
                      ? "bg-[var(--ink)] text-white shadow-[0_16px_30px_-18px_rgba(15,23,42,0.75)]"
                      : "text-[var(--ink)]",
                    isOutsideMonth && !isSelected ? "text-[var(--ink-soft)]" : "",
                    !isDisabled && !isSelected ? "hover:bg-[var(--surface-muted)]" : "",
                    isDisabled ? "cursor-not-allowed text-[var(--ink-soft)] line-through opacity-60" : "",
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

function BookingTimeSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-[var(--ink)] sm:mb-2 sm:text-sm">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-md border border-[var(--line)] bg-white px-3 py-2 text-sm text-[var(--ink)] sm:px-4 sm:py-3"
      >
        {BOOKING_TIME_OPTIONS.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

export function PublicBookingPanel({
  locale,
  vehicleId,
  bookingDailyRate,
  bookingInsuranceFee: localInsuranceFee,
  bookingInsuranceFeeNonLocal,
  bookingDepositAmount,
  bookingTaxName,
  bookingTaxRate,
  taxLines,
  blockedDateWindows,
  busyWindows = [],
  agreementClauses = null,
  returnGraceMinutes,
  bookingNoticeHours = 0,
  turnaroundBufferHours = 0,
  cancellationPolicy = DEFAULT_CANCELLATION_POLICY,
  legalLinks,
  dailyRateOverrides,
  seasonalRates,
  locations,
  addOns = [],
  weeklyDiscountPercent,
  minimumRentalDays,
  dailyKmAllowance,
  extraKmRate,
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
  /** Per day without a BC licence; equal to the above when not different. */
  bookingInsuranceFeeNonLocal?: number;
  bookingDepositAmount: number;
  bookingTaxName: string | null;
  bookingTaxRate: number;
  /** The taxes one by one; the summary shows a line for each. */
  taxLines?: TaxLine[];
  blockedDateWindows: DateOnlyBookingWindow[];
  /** The operator's own clauses, shown verbatim when they have any. */
  agreementClauses?: Array<{ heading: string; body: string }> | null;
  /** When the car is out, to the minute, for checking the chosen times. */
  busyWindows?: BusyWindow[];
  returnGraceMinutes?: number;
  /** A pick-up must be at least this many hours away. */
  bookingNoticeHours?: number;
  /** Hours kept clear before and after every other trip. */
  turnaroundBufferHours?: number;
  /** Stated above the pay button, so it is read before paying. */
  cancellationPolicy?: CancellationPolicyKey;
  /** The operator's booking terms and privacy policy, on a site page. */
  legalLinks?: { brand: string; terms: string; privacy: string };
  /** `YYYY-MM-DD` → price, for days the operator priced by hand. */
  dailyRateOverrides: Record<string, number>;
  /** Model pricing per day, empty when a person set the rate. */
  seasonalRates: Record<string, number>;
  /** Places the car may be collected from and returned to. */
  locations: { id: string; label: string; fee: number; isDefault: boolean }[];
  /** Extras the operator offers; the renter ticks the ones they want. */
  addOns?: BookingAddOnOption[];
  weeklyDiscountPercent: number;
  minimumRentalDays: number;
  dailyKmAllowance: number;
  extraKmRate: number;
  stripeReady: boolean;
  hostPayoutsReady: boolean;
  defaultPickupDate: string;
  defaultReturnDate: string;
  checkoutState: CheckoutState;
}) {
  const messages = getMessages(locale);
  const reserveMessages = messages.reservePage;
  const storageKey = `${STORAGE_PREFIX}${vehicleId}`;
  // The first day a pick-up can fall on, once the operator's notice is
  // counted: with 24 hours' notice at 3 p.m., that is tomorrow.
  const earliestPickupDate = useMemo(
    () => utcToZonedDate(earliestPickupAt(bookingNoticeHours)),
    [bookingNoticeHours],
  );
  const blockedDateSet = useMemo(
    () => expandBlockedBookingDates(blockedDateWindows),
    [blockedDateWindows],
  );

  const [pickupDate, setPickupDate] = useState(defaultPickupDate);
  const [returnDate, setReturnDate] = useState(defaultReturnDate);
  const [pickupTime, setPickupTime] = useState(DEFAULT_BOOKING_TIME);
  const [returnTime, setReturnTime] = useState(DEFAULT_BOOKING_TIME);
  const [renterFirstName, setRenterFirstName] = useState("");
  const [renterLastName, setRenterLastName] = useState("");
  // What the booking, the contract and the emails call the renter.
  const renterName = `${renterFirstName.trim()} ${renterLastName.trim()}`.trim();
  const [renterEmail, setRenterEmail] = useState("");
  const [renterPhone, setRenterPhone] = useState("");
  // Only asked when the answer changes the price.
  const asksLicenceRegion =
    bookingInsuranceFeeNonLocal != null && bookingInsuranceFeeNonLocal !== localInsuranceFee;
  const [hasLocalLicence, setHasLocalLicence] = useState<"yes" | "no" | "">("");
  const bookingInsuranceFee =
    asksLicenceRegion && hasLocalLicence === "no"
      ? (bookingInsuranceFeeNonLocal ?? localInsuranceFee)
      : localInsuranceFee;
  const [addOnIds, setAddOnIds] = useState<string[]>([]);
  // In the operator's order, and only ones still on offer.
  const selectedAddOns = useMemo(
    () => addOns.filter((addOn) => addOnIds.includes(addOn.id)),
    [addOns, addOnIds],
  );
  const [couponInput, setCouponInput] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState<CouponDiscount | null>(null);
  const [couponError, setCouponError] = useState("");
  const [couponChecking, setCouponChecking] = useState(false);

  // Checked with the server before it prices anything, so a mistyped
  // code says so here rather than at the payment step.
  async function applyCoupon() {
    setCouponError("");
    setCouponChecking(true);
    try {
      const response = await fetch("/api/direct-booking/coupons/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vehicleId, code: normalizeCouponCode(couponInput) }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        reason?: keyof typeof reserveMessages.couponErrors;
        coupon?: CouponDiscount;
      };
      if (data.ok && data.coupon) {
        setAppliedCoupon(data.coupon);
      } else {
        setCouponError(
          reserveMessages.couponErrors[data.reason ?? "not_found"] ?? reserveMessages.couponErrors.not_found,
        );
      }
    } catch {
      setCouponError(reserveMessages.couponErrors.not_found);
    } finally {
      setCouponChecking(false);
    }
  }

  const [licenseFront, setLicenseFront] = useState<File | null>(null);
  const [licenseBack, setLicenseBack] = useState<File | null>(null);
  const [agreementAccepted, setAgreementAccepted] = useState(false);
  // The renter's drawn signature; the agreement is signed with it once
  // the booking is paid. Not saved across reloads -- a signature is
  // given, not restored.
  const [signature, setSignature] = useState("");
  // Phones only: the clauses fold behind a toggle so the page stays short.
  const [showClauses, setShowClauses] = useState(false);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  const isPickupDateDisabled = useCallback(
    (candidate: string) => {
      // Only the day itself decides. The return date used to fence the
      // pickup in too -- nothing after it, nothing that clashes with it
      // -- so with the default one-night trip on screen every later day
      // was struck through, and a renter could not move their trip
      // forward at all. Picking a pickup now moves the return instead.
      if (candidate < earliestPickupDate) return true;
      return blockedDateSet.has(candidate);
    },
    [blockedDateSet, earliestPickupDate],
  );

  const isReturnDateDisabled = useCallback(
    (candidate: string) => {
      if (!pickupDate) return true;
      // Same day is fine now that there are times to tell them apart.
      if (candidate < pickupDate) return true;

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
      if (isBookingTime(parsed.pickupTime)) setPickupTime(parsed.pickupTime);
      if (isBookingTime(parsed.returnTime)) setReturnTime(parsed.returnTime);
      if (parsed.hasLocalLicence === "yes" || parsed.hasLocalLicence === "no") {
        setHasLocalLicence(parsed.hasLocalLicence);
      }
      if (parsed.renterFirstName != null || parsed.renterLastName != null) {
        setRenterFirstName(parsed.renterFirstName || "");
        setRenterLastName(parsed.renterLastName || "");
      } else if (parsed.renterName) {
        // Saved by the page before names were split.
        const [first, ...rest] = parsed.renterName.trim().split(/\s+/);
        setRenterFirstName(first ?? "");
        setRenterLastName(rest.join(" "));
      }
      setRenterEmail(parsed.renterEmail || "");
      setRenterPhone(parsed.renterPhone || "");
      setAgreementAccepted(Boolean(parsed.agreementAccepted));
      if (Array.isArray(parsed.addOnIds)) setAddOnIds(parsed.addOnIds);
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
      pickupTime,
      returnTime,
      hasLocalLicence,
      renterFirstName,
      renterLastName,
      renterEmail,
      renterPhone,
      agreementAccepted,
      addOnIds,
    };

    window.sessionStorage.setItem(storageKey, JSON.stringify(payload));
  }, [
    addOnIds,
    agreementAccepted,
    hasLocalLicence,
    pickupTime,
    returnTime,
    pickupDate,
    renterEmail,
    renterFirstName,
    renterLastName,
    renterPhone,
    returnDate,
    storageKey,
  ]);

  // The same inputs the server will bill from, so what the renter is
  // shown here and what their card is charged cannot disagree.
  const defaultLocationId =
    locations.find((location) => location.isDefault)?.id ?? locations[0]?.id ?? "";
  const [pickupLocationId, setPickupLocationId] = useState(defaultLocationId);
  const [returnLocationId, setReturnLocationId] = useState(defaultLocationId);
  const pickupLocationFee =
    locations.find((location) => location.id === pickupLocationId)?.fee ?? 0;
  const returnLocationFee =
    locations.find((location) => location.id === returnLocationId)?.fee ?? 0;

  const plan = useMemo(
    () =>
      getDirectBookingInstalmentPlan({
        pickupDate,
        returnDate,
        weeklyDiscountPercent,
        dailyRateOverrides,
        seasonalRates,
        pickupLocationFee,
        returnLocationFee,
        bookingDailyRate,
        bookingInsuranceFee,
        bookingDepositAmount,
        bookingTaxRate,
        taxLines,
        pickupTime,
        returnTime,
        graceMinutes: returnGraceMinutes,
        coupon: appliedCoupon,
        addOns: selectedAddOns,
      }),
    [
      selectedAddOns,
      bookingDailyRate,
      bookingDepositAmount,
      bookingInsuranceFee,
      bookingTaxRate,
      taxLines,
      pickupTime,
      returnTime,
      returnGraceMinutes,
      appliedCoupon,
      pickupDate,
      returnDate,
      weeklyDiscountPercent,
      dailyRateOverrides,
      seasonalRates,
      pickupLocationFee,
      returnLocationFee,
    ],
  );

  const quote = useMemo(
    () =>
      getDirectBookingQuote({
        pickupDate,
        returnDate,
        weeklyDiscountPercent,
        dailyRateOverrides,
        seasonalRates,
        pickupLocationFee,
        returnLocationFee,
        bookingDailyRate,
        bookingInsuranceFee,
        bookingDepositAmount,
        bookingTaxRate,
        taxLines,
        pickupTime,
        returnTime,
        graceMinutes: returnGraceMinutes,
        coupon: appliedCoupon,
        addOns: selectedAddOns,
      }),
    [
      selectedAddOns,
      bookingDailyRate,
      bookingDepositAmount,
      bookingInsuranceFee,
      bookingTaxRate,
      taxLines,
      pickupTime,
      returnTime,
      returnGraceMinutes,
      appliedCoupon,
      pickupDate,
      returnDate,
      weeklyDiscountPercent,
      dailyRateOverrides,
      seasonalRates,
      pickupLocationFee,
      returnLocationFee,
    ],
  );

  // The chosen moments, checked against when the car is actually out.
  // The date pickers only know whole days; this is what catches a
  // pickup at nine on the morning another renter returns at noon.
  const pickupAt = pickupDate ? zonedDateTimeToUtc(pickupDate, pickupTime) : null;
  const returnAt = returnDate ? zonedDateTimeToUtc(returnDate, returnTime) : null;
  const padded = pickupAt && returnAt ? padTripWindow(pickupAt, returnAt, turnaroundBufferHours) : null;
  const timeError =
    pickupAt && returnAt && padded
      ? returnAt <= pickupAt
        ? reserveMessages.timeOrderError
        : pickupAt < earliestPickupAt(bookingNoticeHours)
          ? reserveMessages.noticeError(bookingNoticeHours)
          : hasBusyWindowConflict(busyWindows, pickupAt, returnAt)
            ? reserveMessages.timeConflictError
            : hasBusyWindowConflict(busyWindows, padded.start, padded.end)
              ? reserveMessages.bufferError(turnaroundBufferHours)
              : ""
      : "";

  function handlePickupDateChange(nextValue: string) {
    setError("");
    setPickupDate(nextValue);

    // Keep the return if it still makes a trip; otherwise offer the
    // next day, or leave it for the renter to pick when that clashes.
    if (
      returnDate &&
      returnDate >= nextValue &&
      !hasDateOnlyBookingConflict(blockedDateWindows, nextValue, returnDate)
    ) {
      return;
    }
    const picked = parseDateOnly(nextValue);
    const nextDay = picked ? formatDateOnlyValue(addUtcDays(picked, 1)) : "";
    setReturnDate(
      !nextDay || hasDateOnlyBookingConflict(blockedDateWindows, nextValue, nextDay) ? "" : nextDay,
    );
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

    if (quote.days < minimumRentalDays) {
      setError(reserveMessages.minimumDaysError(minimumRentalDays));
      return;
    }

    if (hasDateOnlyBookingConflict(blockedDateWindows, pickupDate, returnDate)) {
      setError(reserveMessages.conflictError);
      return;
    }

    if (timeError) {
      setError(timeError);
      return;
    }

    if (!renterFirstName.trim() || !renterLastName.trim() || !renterEmail.trim()) {
      setError(reserveMessages.missingFields);
      return;
    }

    if (asksLicenceRegion && !hasLocalLicence) {
      setError(reserveMessages.licenceRegionMissingError);
      return;
    }

    if (!licenseFront || !licenseBack) {
      setError(reserveMessages.licenseMissingError);
      return;
    }

    if (!agreementAccepted) {
      setError(reserveMessages.agreementMissingError);
      return;
    }

    if (!signature) {
      setError(reserveMessages.signatureMissingError);
      return;
    }

    // The funnel step between "looked at a car" and "paid", valued the
    // way the purchase will be so the two can be compared. A no-op on
    // pages without a Google tag.
    const gtag = (window as unknown as { gtag?: (...args: unknown[]) => void }).gtag;
    if (typeof gtag === "function") {
      gtag("event", "begin_checkout", {
        currency: "CAD",
        value: Math.max(
          0,
          Math.round((plan.totalAmount - quote.depositAmount - quote.taxAmount) * 100) / 100,
        ),
        items: [{ item_id: vehicleId, quantity: quote.days }],
      });
    }

    startTransition(async () => {
      const formData = new FormData();
      formData.set("vehicleId", vehicleId);
      formData.set("locale", locale);
      formData.set("pickupDate", pickupDate);
      formData.set("returnDate", returnDate);
      formData.set("pickupTime", pickupTime);
      formData.set("returnTime", returnTime);
      formData.set("renterName", renterName);
      formData.set("renterEmail", renterEmail);
      formData.set("renterPhone", renterPhone);
      formData.set("pickupLocationId", pickupLocationId);
      formData.set("returnLocationId", returnLocationId);
      formData.set("agreementAccepted", agreementAccepted ? "true" : "false");
      if (asksLicenceRegion) formData.set("hasLocalLicence", hasLocalLicence);
      if (appliedCoupon) formData.set("couponCode", appliedCoupon.code);
      for (const addOn of selectedAddOns) formData.append("addOnId", addOn.id);
      formData.set("signature", signature);
      formData.set("licenseFront", licenseFront);
      formData.set("licenseBack", licenseBack);

      const response = await fetch("/api/direct-booking/checkout", {
        method: "POST",
        body: formData,
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
    <div className="rounded-lg border border-[var(--line)] bg-white p-3.5 text-[var(--ink)] shadow-[0_30px_80px_-55px_rgba(15,23,42,0.65)] sm:p-6">
      <p className="text-[11px] uppercase tracking-[0.32em] text-[var(--ink-soft)]">
        {reserveMessages.bookingPanelTitle}
      </p>
      <p className="mt-1 hidden max-w-lg text-xs leading-5 text-[var(--ink-mid)] sm:mt-3 sm:block sm:text-sm sm:leading-6">{reserveMessages.bookingPanelCopy}</p>

      {checkoutState === "success" ? (
        <div className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {reserveMessages.successNotice}
        </div>
      ) : null}

      {checkoutState === "cancelled" ? (
        <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {reserveMessages.cancelledNotice}
        </div>
      ) : null}

      {checkoutState === "error" ? (
        <div className="mt-5 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {reserveMessages.errorNotice}
        </div>
      ) : null}

      {/* Each leg on its own row: its date, then its time. */}
      <div className="mt-3 grid grid-cols-2 gap-2 sm:mt-6 sm:gap-4">
        <BookingDatePicker
          locale={locale}
          label={reserveMessages.pickupDate}
          value={pickupDate}
          placeholder={reserveMessages.selectDatePlaceholder}
          onChange={handlePickupDateChange}
          isDateDisabled={isPickupDateDisabled}
          minDate={earliestPickupDate}
        />
        <BookingTimeSelect
          label={reserveMessages.pickupTime}
          value={pickupTime}
          onChange={(value) => {
            setError("");
            setPickupTime(value);
          }}
        />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:mt-3 sm:gap-4">
        <BookingDatePicker
          locale={locale}
          label={reserveMessages.returnDate}
          value={returnDate}
          placeholder={reserveMessages.selectDatePlaceholder}
          onChange={handleReturnDateChange}
          isDateDisabled={isReturnDateDisabled}
          minDate={pickupDate}
          disabled={!pickupDate}
        />
        <BookingTimeSelect
          label={reserveMessages.returnTime}
          value={returnTime}
          onChange={(value) => {
            setError("");
            setReturnTime(value);
          }}
        />
      </div>
      <p className="mt-1.5 text-[11px] leading-4 text-[var(--ink-soft)] sm:mt-2 sm:text-xs sm:leading-5">
        {reserveMessages.timeZoneNote}
        {quote.days > 0 && !timeError ? ` ${reserveMessages.chargedDaysNote(quote.days)}` : ""}
      </p>
      {timeError ? (
        <p className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
          {timeError}
        </p>
      ) : null}

      <div className="mt-3 grid grid-cols-2 gap-2 sm:mt-4 sm:gap-4">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-[var(--ink)] sm:mb-2 sm:text-sm">{reserveMessages.renterFirstName}</span>
          <input
            value={renterFirstName}
            autoComplete="given-name"
            onChange={(event) => setRenterFirstName(event.target.value)}
            className="w-full rounded-md border border-[var(--line)] bg-white px-3 py-2 text-sm text-[var(--ink)] outline-none sm:px-4 sm:py-3 transition focus:border-[var(--line-strong)] focus:ring-2 focus:ring-[var(--line)]"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-[var(--ink)] sm:mb-2 sm:text-sm">{reserveMessages.renterLastName}</span>
          <input
            value={renterLastName}
            autoComplete="family-name"
            onChange={(event) => setRenterLastName(event.target.value)}
            className="w-full rounded-md border border-[var(--line)] bg-white px-3 py-2 text-sm text-[var(--ink)] outline-none sm:px-4 sm:py-3 transition focus:border-[var(--line-strong)] focus:ring-2 focus:ring-[var(--line)]"
          />
        </label>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:mt-4 sm:gap-4">
        <label className="block min-w-0">
          <span className="mb-1 block text-xs font-medium text-[var(--ink)] sm:mb-2 sm:text-sm">{reserveMessages.renterEmail}</span>
          <input
            type="email"
            autoComplete="email"
            value={renterEmail}
            onChange={(event) => setRenterEmail(event.target.value)}
            className="w-full rounded-md border border-[var(--line)] bg-white px-3 py-2 text-sm text-[var(--ink)] outline-none sm:px-4 sm:py-3 transition focus:border-[var(--line-strong)] focus:ring-2 focus:ring-[var(--line)]"
          />
        </label>
        <label className="block min-w-0">
          <span className="mb-1 block text-xs font-medium text-[var(--ink)] sm:mb-2 sm:text-sm">{reserveMessages.renterPhone}</span>
          <input
            type="tel"
            autoComplete="tel"
            value={renterPhone}
            onChange={(event) => setRenterPhone(event.target.value)}
            className="w-full rounded-md border border-[var(--line)] bg-white px-3 py-2 text-sm text-[var(--ink)] outline-none sm:px-4 sm:py-3 transition focus:border-[var(--line-strong)] focus:ring-2 focus:ring-[var(--line)]"
          />
        </label>
      </div>

      <div className="mt-3 rounded-lg border border-[var(--line)] bg-white p-3 sm:mt-5 sm:p-4">
        <p className="text-sm font-semibold text-[var(--ink)]">{reserveMessages.licenseUploadTitle}</p>
        <p className="mt-0.5 text-[11px] leading-4 text-[var(--ink-soft)] sm:mt-1 sm:text-xs sm:leading-5">{reserveMessages.licenseUploadCopy}</p>
        {asksLicenceRegion ? (
          <fieldset className="mt-2.5 sm:mt-4">
            <legend className="text-xs font-medium sm:text-sm text-[var(--ink)]">
              {reserveMessages.licenceRegionQuestion}
            </legend>
            <div className="mt-1.5 grid grid-cols-2 gap-2 sm:mt-2">
              {(
                [
                  { value: "yes" as const, label: reserveMessages.licenceRegionYes },
                  { value: "no" as const, label: reserveMessages.licenceRegionNo },
                ]
              ).map((option) => (
                <label
                  key={option.value}
                  className={cn(
                    "flex cursor-pointer items-start gap-2 rounded-md border px-2.5 py-2 text-xs transition sm:px-3 sm:py-2.5 sm:text-sm",
                    hasLocalLicence === option.value
                      ? "border-[var(--ink)] bg-[var(--surface-muted)]"
                      : "border-[var(--line)] bg-white hover:border-[var(--line-strong)]",
                  )}
                >
                  <input
                    type="radio"
                    name="hasLocalLicence"
                    value={option.value}
                    checked={hasLocalLicence === option.value}
                    onChange={() => {
                      setError("");
                      setHasLocalLicence(option.value);
                    }}
                    className="mt-0.5"
                  />
                  <span className="block font-medium text-[var(--ink)]">{option.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
        <div className="mt-2.5 grid grid-cols-2 gap-2 sm:mt-4 sm:gap-3">
          <label className="block min-w-0">
            <span className="mb-1 block text-xs font-medium text-[var(--ink)] sm:mb-2 sm:text-sm">
              {reserveMessages.licenseFrontLabel}
            </span>
            <input
              type="file"
              accept="image/*,.pdf"
              onChange={(event) => {
                setError("");
                setLicenseFront(event.target.files?.[0] ?? null);
              }}
              className="w-full rounded-md border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2 text-xs text-[var(--ink-mid)] file:mr-2 file:rounded-md file:border-0 file:bg-[var(--ink)] file:px-2.5 file:py-1.5 sm:file:mr-3 sm:file:px-3 sm:file:py-2 file:text-xs file:font-semibold file:text-white"
            />
            {licenseFront ? (
              <span className="mt-1 block truncate text-xs text-[var(--ink-soft)]">
                {licenseFront.name}
              </span>
            ) : null}
          </label>
          <label className="block min-w-0">
            <span className="mb-1 block text-xs font-medium text-[var(--ink)] sm:mb-2 sm:text-sm">
              {reserveMessages.licenseBackLabel}
            </span>
            <input
              type="file"
              accept="image/*,.pdf"
              onChange={(event) => {
                setError("");
                setLicenseBack(event.target.files?.[0] ?? null);
              }}
              className="w-full rounded-md border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2 text-xs text-[var(--ink-mid)] file:mr-2 file:rounded-md file:border-0 file:bg-[var(--ink)] file:px-2.5 file:py-1.5 sm:file:mr-3 sm:file:px-3 sm:file:py-2 file:text-xs file:font-semibold file:text-white"
            />
            {licenseBack ? (
              <span className="mt-1 block truncate text-xs text-[var(--ink-soft)]">
                {licenseBack.name}
              </span>
            ) : null}
          </label>
        </div>
        <p className="mt-3 hidden text-xs leading-5 text-[var(--ink-soft)] sm:block">{reserveMessages.licenseUploadHint}</p>
      </div>

      {locations.length > 1 ? (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:mt-5 sm:gap-3">
          {(
            [
              {
                key: "pickup" as const,
                label: reserveMessages.pickupLocationLabel,
                value: pickupLocationId,
                onChange: setPickupLocationId,
              },
              {
                key: "return" as const,
                label: reserveMessages.returnLocationLabel,
                value: returnLocationId,
                onChange: setReturnLocationId,
              },
            ]
          ).map((field) => (
            <label key={field.key} className="block min-w-0">
              <span className="mb-1 block text-xs font-medium text-[var(--ink-mid)]">
                {field.label}
              </span>
              <select
                value={field.value}
                onChange={(event) => field.onChange(event.target.value)}
                className="h-9 w-full rounded-[var(--control-radius)] sm:h-11 border border-[var(--line-strong)] bg-white px-3 text-sm text-[var(--ink)]"
              >
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.fee > 0
                      ? reserveMessages.locationOption(
                          location.label,
                          formatCurrency(location.fee, locale),
                        )
                      : reserveMessages.locationOptionFree(location.label)}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      ) : null}

      {addOns.length > 0 ? (
        <fieldset className="mt-3 sm:mt-5">
          <legend className="mb-1 text-xs font-medium text-[var(--ink)] sm:mb-2 sm:text-sm">
            {reserveMessages.addOnsTitle}
          </legend>
          <div className="grid grid-cols-2 gap-2">
            {addOns.map((addOn) => {
              const checked = addOnIds.includes(addOn.id);
              return (
                <label
                  key={addOn.id}
                  className={cn(
                    "flex cursor-pointer items-start gap-2 rounded-md border px-2.5 py-2 text-xs transition sm:px-3 sm:py-2.5 sm:text-sm",
                    checked
                      ? "border-[var(--ink)] bg-[var(--surface-muted)]"
                      : "border-[var(--line)] bg-white hover:border-[var(--line-strong)]",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => {
                      setError("");
                      setAddOnIds((current) =>
                        event.target.checked
                          ? [...current, addOn.id]
                          : current.filter((id) => id !== addOn.id),
                      );
                    }}
                    className="mt-0.5"
                  />
                  <span className="min-w-0">
                    <span className="block font-medium text-[var(--ink)]">{addOn.name}</span>
                    <span className="block text-[11px] text-[var(--ink-soft)] sm:text-xs">
                      {addOn.unit === "day"
                        ? reserveMessages.addOnPerDay(formatCurrency(addOn.price, locale))
                        : reserveMessages.addOnPerBooking(formatCurrency(addOn.price, locale))}
                    </span>
                    {addOn.description ? (
                      <span className="mt-0.5 block text-[11px] leading-4 text-[var(--ink-soft)]">
                        {addOn.description}
                      </span>
                    ) : null}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      ) : null}

      <div className="mt-3 sm:mt-5">
        <span className="mb-2 hidden text-sm font-medium text-[var(--ink)] sm:block">{reserveMessages.couponLabel}</span>
        {appliedCoupon ? (
          <div className="flex items-center justify-between gap-3 rounded-md border border-[var(--line)] bg-white px-3 py-2 text-sm sm:px-4 sm:py-3">
            <span className="font-medium text-[var(--ok-fg)]">
              {reserveMessages.couponApplied(appliedCoupon.code)}
            </span>
            <button
              type="button"
              onClick={() => {
                setAppliedCoupon(null);
                setCouponInput("");
              }}
              className="text-xs text-[var(--ink-soft)] underline"
            >
              {reserveMessages.couponRemove}
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <input
              value={couponInput}
              onChange={(event) => {
                setCouponInput(event.target.value);
                setCouponError("");
              }}
              placeholder={reserveMessages.couponPlaceholder}
              autoCapitalize="characters"
              className="min-w-0 flex-1 rounded-md border border-[var(--line)] bg-white px-3 py-2 text-sm uppercase text-[var(--ink)] sm:px-4 sm:py-3"
            />
            <button
              type="button"
              onClick={applyCoupon}
              disabled={!couponInput.trim() || couponChecking}
              className="shrink-0 rounded-md border border-[var(--line-strong)] bg-white px-3 py-2 text-sm font-medium text-[var(--ink)] disabled:opacity-50 sm:px-4 sm:py-3"
            >
              {couponChecking ? reserveMessages.couponChecking : reserveMessages.couponApply}
            </button>
          </div>
        )}
        {couponError ? <p className="mt-1 text-xs text-rose-700">{couponError}</p> : null}
      </div>

      <div className="mt-3 rounded-lg border border-[var(--line)] bg-[var(--surface-muted)] p-3 sm:mt-5 sm:p-4">
        <div className="flex items-center justify-between text-sm text-[var(--ink-mid)]">
          <span>{reserveMessages.quoteDays(quote.days)}</span>
          <span>{formatCurrency(renterDailyPrice(bookingDailyRate, bookingInsuranceFee), locale)}</span>
        </div>
        <div className="mt-2 space-y-1 text-[13px] text-[var(--ink-mid)] sm:mt-4 sm:space-y-3 sm:text-sm">
          <div className="flex items-center justify-between">
            <span>{reserveMessages.quoteBase}</span>
            <span>
              {quote.isWeeklyRateApplied ? (
                <span className="mr-2 text-[var(--ink-soft)] line-through">
                  {formatCurrency(quote.listBaseAmount + quote.insuranceAmount, locale)}
                </span>
              ) : null}
              {/* Rent and insurance as one price, before any coupon: the
                  operator does not present insurance as an extra. */}
              {formatCurrency(
                Math.round((quote.baseAmount + quote.couponAmount + quote.insuranceAmount) * 100) / 100,
                locale,
              )}
            </span>
          </div>
          {quote.isWeeklyRateApplied ? (
            <div className="flex items-center justify-between text-[var(--ok-fg)]">
              <span>{reserveMessages.quoteWeeklyDiscount(weeklyDiscountPercent)}</span>
              <span>-{formatCurrency(quote.discountAmount, locale)}</span>
            </div>
          ) : null}
          {appliedCoupon && quote.couponAmount > 0 ? (
            <div className="flex items-center justify-between text-[var(--ok-fg)]">
              <span>{reserveMessages.couponLine(appliedCoupon.code)}</span>
              <span>-{formatCurrency(quote.couponAmount, locale)}</span>
            </div>
          ) : null}
          {quote.addOnLines.map((line) => (
            <div key={line.id} className="flex items-center justify-between gap-3">
              <span className="min-w-0 truncate">
                {line.name}
                {line.unit === "day" && quote.days > 0 ? ` × ${quote.days}` : ""}
              </span>
              <span>{formatCurrency(line.amount, locale)}</span>
            </div>
          ))}
          {/* One line per tax (GST, PST, …), as the receipt will show. */}
          {quote.taxes
            .filter((tax) => tax.amount > 0)
            .map((tax) => (
              <div key={tax.name} className="flex items-center justify-between">
                <span>
                  {(quote.taxes.length === 1 ? bookingTaxName?.trim() || tax.name : tax.name) ||
                    reserveMessages.quoteTax}{" "}
                  ({Number(tax.rate.toFixed(3))}%)
                </span>
                <span>{formatCurrency(tax.amount, locale)}</span>
              </div>
            ))}
          {quote.locationFeeAmount > 0 ? (
            <div className="flex items-center justify-between">
              <span>{reserveMessages.locationFeeLabel}</span>
              <span>{formatCurrency(quote.locationFeeAmount, locale)}</span>
            </div>
          ) : null}
          <div className="flex items-center justify-between">
            <span>{reserveMessages.quoteDeposit}</span>
            <span>{formatCurrency(quote.depositAmount, locale)}</span>
          </div>
        </div>
        {dailyKmAllowance > 0 ? (
          <p className="mt-3 text-[11px] leading-4 text-[var(--ink-soft)]">
            {reserveMessages.mileageIncluded(
              dailyKmAllowance,
              formatCurrency(extraKmRate, locale),
            )}
          </p>
        ) : null}

        <div className="mt-2.5 flex items-center justify-between border-t border-[var(--line)] pt-2.5 sm:mt-4 sm:pt-4">
          <span className="text-sm font-medium text-[var(--ink)]">{reserveMessages.quoteTotal}</span>
          <span
            className={
              plan.isInstalmentPlan
                ? "text-lg font-semibold text-[var(--ink-mid)]"
                : "text-[1.25rem] font-semibold text-[var(--ink)] sm:text-[1.6rem]"
            }
          >
            {formatCurrency(plan.totalAmount, locale)}
          </span>
        </div>

        {plan.isInstalmentPlan ? (
          <div className="mt-4 border-t border-[var(--line)] pt-4">
            <p className="text-sm font-medium text-[var(--ink)]">
              {reserveMessages.instalmentTitle(plan.instalments.length)}
            </p>
            <p className="mt-1 text-xs leading-5 text-[var(--ink-soft)]">
              {reserveMessages.instalmentIntro}
            </p>
            <ul className="mt-3 space-y-2 text-xs text-[var(--ink-mid)]">
              {plan.instalments.map((instalment) => (
                <li key={instalment.index} className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate">
                    {instalment.index === 1
                      ? reserveMessages.instalmentFirst(instalment.startDate, instalment.days)
                      : reserveMessages.instalmentLater(instalment.startDate, instalment.days)}
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {formatCurrency(instalment.total, locale)}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex items-center justify-between border-t border-[var(--line)] pt-3">
              <span className="text-sm font-medium text-[var(--ink)]">
                {reserveMessages.instalmentDueNow}
              </span>
              <span className="text-[1.25rem] font-semibold text-[var(--ink)] sm:text-[1.6rem]">
                {formatCurrency(plan.dueNow, locale)}
              </span>
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-3 rounded-lg border border-[var(--line)] bg-white p-3 sm:mt-5 sm:p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-[var(--ink)]">{reserveMessages.agreementTitle}</p>
          <button
            type="button"
            onClick={() => setShowClauses((current) => !current)}
            className="shrink-0 text-xs text-[var(--ink-mid)] underline sm:hidden"
          >
            {showClauses ? reserveMessages.agreementHide : reserveMessages.agreementShow}
          </button>
        </div>
        <p className="mt-1 hidden text-xs leading-5 text-[var(--ink-soft)] sm:block">{reserveMessages.agreementIntro}</p>
        <div className={cn(showClauses ? "block" : "hidden", "mt-2 max-h-48 sm:mt-3 sm:block sm:max-h-60 overflow-y-auto rounded-md border border-[var(--line)] bg-[var(--surface-muted)]")}>
          {/* The operator's own wording when they have edited it -- a
              translated summary of the built-in clauses would no longer
              describe what they are about to sign. */}
          {(agreementClauses
            ? agreementClauses.map((clause) => ({ title: clause.heading, copy: clause.body }))
            : reserveMessages.agreementSections
          ).map((section, index) => (
            <div key={`${index}-${section.title}`} className="grid gap-1 border-b border-[var(--line)] px-2.5 py-2 last:border-b-0 sm:grid-cols-[8rem_1fr] sm:gap-2 sm:px-3 sm:py-3">
              <p className="text-xs font-semibold leading-5 text-[var(--ink)]">{section.title}</p>
              <p className="text-xs leading-5 text-[var(--ink-mid)]">{section.copy}</p>
            </div>
          ))}
        </div>
        <label className="mt-2 flex items-start gap-2.5 rounded-md border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2 sm:mt-3 sm:gap-3 sm:py-3">
          <input
            type="checkbox"
            checked={agreementAccepted}
            onChange={(event) => {
              setError("");
              setAgreementAccepted(event.target.checked);
            }}
            className="mt-1 h-4 w-4 rounded border-[var(--line-strong)]"
          />
          <span className="text-[13px] leading-5 text-[var(--ink-mid)] sm:text-sm sm:leading-6">
            {reserveMessages.agreementCheckbox}
          </span>
        </label>
        <div className="mt-2 sm:mt-3">
          <p className="text-xs font-medium text-[var(--ink)] sm:text-sm">
            {reserveMessages.signatureLabel(renterName || "")}
          </p>
          <SignaturePad
            value={signature}
            onChange={(value) => {
              setError("");
              setSignature(value);
            }}
            clearLabel={reserveMessages.signatureClear}
          />
          <p className="mt-1 text-[11px] leading-4 text-[var(--ink-soft)] sm:text-xs sm:leading-5">
            {reserveMessages.signatureNote}
          </p>
        </div>
      </div>

      <div
        className={cn(
          "mt-3 items-center justify-between rounded-md border border-[var(--line)] bg-white px-3 py-2 sm:mt-4 sm:flex sm:px-4 sm:py-3",
          stripeReady && hostPayoutsReady ? "hidden" : "flex",
        )}
      >
        <div>
          <p className="text-[13px] font-medium text-[var(--ink)] sm:text-sm">
            {!stripeReady
              ? reserveMessages.stripeMissing
              : !hostPayoutsReady
                ? reserveMessages.hostPayoutsMissing
                : reserveMessages.stripeReady}
          </p>
          <p className="mt-0.5 text-[11px] text-[var(--ink-soft)] sm:mt-1 sm:text-xs">
            {!hostPayoutsReady && stripeReady
              ? reserveMessages.hostPayoutsHint
              : reserveMessages.checkoutHelp}
          </p>
        </div>
      </div>

      <p className="mt-3 text-[11px] leading-4 text-[var(--ink-soft)] sm:mt-4 sm:text-xs sm:leading-5">
        <span className="font-medium text-[var(--ink)]">
          {messages.cancellationPolicies.label} · {messages.cancellationPolicies[cancellationPolicy].name}
        </span>{" "}
        {messages.cancellationPolicies[cancellationPolicy].summary} {messages.cancellationPolicies.depositNote}
      </p>
      {legalLinks ? (
        <p className="mt-1.5 text-[11px] leading-4 text-[var(--ink-soft)] sm:text-xs sm:leading-5">
          {messages.legal.bookingConsent(legalLinks.brand)}{" "}
          <a href={legalLinks.terms} target="_blank" rel="noreferrer" className="underline">
            {messages.legal.termsLink}
          </a>
          {" · "}
          <a href={legalLinks.privacy} target="_blank" rel="noreferrer" className="underline">
            {messages.legal.privacyLink}
          </a>
        </p>
      ) : null}

      {error ? (
        <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </div>
      ) : null}

      <button
        onClick={startCheckout}
        disabled={!stripeReady || !hostPayoutsReady || isPending}
        className="mt-3 w-full rounded-md bg-[var(--ink)] px-4 py-3 text-sm sm:mt-5 sm:py-3.5 font-semibold text-white shadow-[0_18px_40px_-24px_rgba(15,23,42,0.9)] transition hover:translate-y-[-1px] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending ? reserveMessages.checkoutLoading : reserveMessages.checkoutAction}
      </button>
    </div>
  );
}
