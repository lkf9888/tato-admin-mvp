import { clsx, type ClassValue } from "clsx";

import { getLocaleTag, type Locale } from "@/lib/i18n";

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

function padDatePart(value: number) {
  return value.toString().padStart(2, "0");
}

function toDate(value: Date | string) {
  return value instanceof Date ? value : new Date(value);
}

export function formatDateTime(value: Date | string, locale: Locale = "en") {
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return "—";
  return `${formatDate(date, locale)} ${formatTime(date)}`;
}

export function formatDate(value: Date | string, locale: Locale = "en") {
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return "—";
  return `${date.getFullYear()}/${padDatePart(date.getMonth() + 1)}/${padDatePart(date.getDate())}`;
}

export function formatTime(value: Date | string) {
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return "—";
  return `${padDatePart(date.getHours())}:${padDatePart(date.getMinutes())}`;
}

export function formatDateTimeLocalInput(value: Date | string) {
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}T${padDatePart(date.getHours())}:${padDatePart(date.getMinutes())}`;
}

export function formatDateInputDisplay(value: Date | string) {
  return formatDate(value);
}

export function formatTimeInputDisplay(value: Date | string) {
  return formatTime(value);
}

export function parseDateInputDisplay(value: string) {
  const match = /^\s*(\d{4})[/-](\d{1,2})[/-](\d{1,2})\s*$/.exec(value);
  if (!match) return null;

  const [, rawYear, rawMonth, rawDay] = match;
  const year = Number(rawYear);
  const month = Number(rawMonth);
  const day = Number(rawDay);
  const date = new Date(year, month - 1, day);

  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

export function parseTimeInputDisplay(value: string) {
  const match = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(value);
  if (!match) return null;

  const [, rawHour, rawMinute] = match;
  const hour = Number(rawHour);
  const minute = Number(rawMinute);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

  return { hour, minute };
}

export function parseDateTimeInputParts(dateValue: string, timeValue: string) {
  const date = parseDateInputDisplay(dateValue);
  const time = parseTimeInputDisplay(timeValue);
  if (!date || !time) return null;

  date.setHours(time.hour, time.minute, 0, 0);
  return date;
}

export function composeDateTimeLocalInput(dateValue: string, timeValue: string) {
  const date = parseDateTimeInputParts(dateValue, timeValue);
  return date ? formatDateTimeLocalInput(date) : "";
}

export function formatCurrency(value?: number | null, locale: Locale = "en") {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(getLocaleTag(locale), {
    style: "currency",
    currency: "CAD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function roundCurrencyAmount(value?: number | null) {
  if (value == null || !Number.isFinite(value)) return null;

  // The previous implementation built a string — `${value}e2` — and
  // re-parsed it. For any |value| below 1e-6, String(value) is already
  // in exponential form, so that produced garbage like "1.13e-13e2"
  // and returned NaN. The `Number.isFinite` guard above doesn't catch
  // it because the *input* is finite; the NaN is manufactured by the
  // rounding itself. That NaN then reached `Order.totalPrice`, where
  // the write threw and the row was reported as a generic import
  // failure.
  //
  // Sub-cent residues are float noise from summing money, not real
  // amounts — snap them to zero so `829.35 - 100.05 - 729.30` yields 0
  // rather than 1.1368683772161603e-13.
  if (Math.abs(value) < 0.005) return 0;
  return Math.round(value * 100) / 100;
}

export function formatCurrencyInputValue(value?: number | null) {
  const rounded = roundCurrencyAmount(value);
  return rounded == null ? "" : rounded.toFixed(2);
}

export function formatCurrencyInputText(value: string) {
  const normalized = value.trim();
  if (!normalized) return "";

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? formatCurrencyInputValue(parsed) : value;
}

export function maskPhone(value?: string | null) {
  if (!value) return "—";
  const digits = value.replace(/\D/g, "");
  if (digits.length < 4) return "****";
  return `***-***-${digits.slice(-4)}`;
}

export function normalizeText(value?: string | null) {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function parseDateValue(value: string | Date) {
  return value instanceof Date ? value : new Date(value);
}

export function parseNumberValue(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return null;

  const raw = value.trim();
  if (!raw) return null;

  // Accounting notation: "(25.00)" means -25.00. The old implementation
  // stripped every non-[0-9.-] character, which threw away the very
  // parentheses that carried the sign — so a -$25.00 charge parsed as
  // +25.00 and the net-earning math moved it in the wrong direction, a
  // $50 swing per affected row straight into the owner ledger.
  //
  // Match the parens anywhere in the string, not anchored: real exports
  // write "$ (25.00)" and "(25.00) CAD" as well as bare "(25.00)".
  const negatedByParens = /\(\s*[\d.,]+\s*\)/.test(raw);

  // Trailing minus ("1,234.56-") is another accounting convention that
  // the old character-class strip mangled: it kept the '-' but left it
  // at the end, producing an unparseable "1234.56-".
  const negatedBySuffix = /-\s*$/.test(raw);

  let normalized = raw
    .replace(/[()]/g, "")
    .replace(/-\s*$/, "")
    .replace(/[^0-9.,\-]/g, "");

  // Reject ambiguous grouping rather than silently mis-scaling it.
  // "1 234,50" (fr-CA) used to become 123450 — a 100x inflation. If a
  // comma is used as a decimal separator we can't distinguish it from a
  // thousands separator without locale context, so refuse the value and
  // let the row surface as a failure instead of importing a wrong
  // number.
  const commaCount = (normalized.match(/,/g) || []).length;
  const dotCount = (normalized.match(/\./g) || []).length;
  if (commaCount > 0) {
    if (dotCount > 0) {
      // "1,234.56" — comma is grouping, safe to drop.
      normalized = normalized.replace(/,/g, "");
    } else if (/,\d{3}(?:$|\D)/.test(normalized)) {
      // "1,234" — comma followed by exactly 3 digits reads as grouping.
      normalized = normalized.replace(/,/g, "");
    } else {
      // "1,5" or "1,50" — decimal comma, or something we can't classify.
      return null;
    }
  }

  if (!normalized || normalized === "-" || normalized === ".") return null;

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;

  return negatedByParens || negatedBySuffix ? -Math.abs(parsed) : parsed;
}

type ImportedOrderMetadata = {
  financials?: Record<string, string>;
  rawRow?: Record<string, string>;
  vehicle?: {
    label?: string | null;
    name?: string | null;
    vehicleId?: string | null;
    vin?: string | null;
  };
};


export function parseImportedOrderMetadata(value?: string | null) {
  if (!value) return null;

  try {
    return JSON.parse(value) as ImportedOrderMetadata;
  } catch {
    return null;
  }
}

/**
 * The host's net earning for an imported Turo trip.
 *
 * `Total earnings` in Turo's export is **already the final host payout** —
 * verified against a real 2,183-row export (2016 → 2026): for every
 * single row, `Total earnings` equals the sum of all 31 component
 * columns (trip price, boost, every discount, every fee, sales tax).
 * Turo has already done the arithmetic; there is nothing left to net
 * out.
 *
 * This function used to subtract 17 of those component columns from
 * `Total earnings` a second time. Across that same export the effect
 * was **-$68,576 on $417,605, understating revenue by 16.4%** — and
 * because `lib/orders.ts` computes `Order.totalPrice` with this
 * function at import time, the understated figure was what landed in
 * the database and fed every downstream surface: dashboard revenue,
 * vehicle ROI, the orders list, owner ledger rows, owner statements,
 * and the CSV export.
 *
 * The subtracted columns were not expenses at all:
 *   · Delivery ($32,405) — money the host earned for delivering
 *   · Extras / Airport operations fee — host service revenue
 *   · Late fee, Improper return fee, Cancellation fee,
 *     "Fines (paid to host)" — literally labelled as paid *to* the host
 *   · Gas reimbursement, Tolls & tickets, EV charging, Cleaning —
 *     reimbursements the guest paid the host
 *
 * The math was also internally inconsistent: it added back
 * `Airport parking credit`, a column that was never in the subtracted
 * set to begin with.
 *
 * NOTE ON OWNER SPLITS: whether *reimbursements* (gas / tolls / charging
 * / cleaning — about $24.5k of the above) should reach the vehicle
 * owner or stay with the fleet manager who fronted those costs is a
 * real business question. It does not belong here. `Order.totalPrice`
 * is what the vehicle earned, and vehicle ROI depends on that being
 * true. If reimbursements should be withheld from an owner's share,
 * that belongs in `lib/owner-ledger.ts` as an explicit, auditable
 * deduction line on the statement — not silently folded into the
 * order's revenue.
 */
export function getNetEarningFromFinancials(
  financials?: Record<string, string>,
  fallbackValue?: number | null,
) {
  const totalEarnings = parseNumberValue(financials?.["Total earnings"]);
  return totalEarnings ?? fallbackValue ?? null;
}

export function getOrderNetEarning(sourceMetadata?: string | null, fallbackValue?: number | null) {
  if (fallbackValue != null) return fallbackValue;

  const metadata = parseImportedOrderMetadata(sourceMetadata);
  return getNetEarningFromFinancials(metadata?.financials, fallbackValue);
}

export function getImportedOrderDistanceKilometers(sourceMetadata?: string | null) {
  const metadata = parseImportedOrderMetadata(sourceMetadata);
  const rawRow = metadata?.rawRow;

  const directDistance = parseNumberValue(rawRow?.["Distance traveled"]);
  if (directDistance != null && directDistance > 0) return directDistance;

  const checkInOdometer = parseNumberValue(rawRow?.["Check-in odometer"]);
  const checkOutOdometer = parseNumberValue(rawRow?.["Check-out odometer"]);

  if (
    checkInOdometer != null &&
    checkOutOdometer != null &&
    checkOutOdometer >= checkInOdometer
  ) {
    return checkOutOdometer - checkInOdometer;
  }

  return null;
}

export function formatNumber(
  value?: number | null,
  locale: Locale = "en",
  maximumFractionDigits = 1,
) {
  if (value == null || Number.isNaN(value)) return "—";

  return new Intl.NumberFormat(getLocaleTag(locale), {
    maximumFractionDigits,
  }).format(value);
}

export function formatPercentage(
  value?: number | null,
  locale: Locale = "en",
  maximumFractionDigits = 1,
) {
  if (value == null || Number.isNaN(value)) return "—";

  return new Intl.NumberFormat(getLocaleTag(locale), {
    style: "percent",
    maximumFractionDigits,
  }).format(value / 100);
}

export function safeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function getDisplayOrderNote(
  note?: string | null,
  source?: "turo" | "offline" | string | null,
) {
  const normalized = note?.trim();
  if (!normalized) return null;

  if (source === "turo" && /^Imported from .+\.csv$/i.test(normalized)) {
    return null;
  }

  return normalized;
}
