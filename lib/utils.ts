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
  if (value == null || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat(getLocaleTag(locale), {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 2,
  }).format(value);
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
  const normalized = value.replace(/[^0-9.-]/g, "");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
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

const NET_EARNING_EXPENSE_KEYS = [
  "Delivery",
  "Excess distance",
  "Extras",
  "Cancellation fee",
  "Additional usage",
  "Late fee",
  "Improper return fee",
  "Airport operations fee",
  "Tolls & tickets",
  "On-trip EV charging",
  "Post-trip EV charging",
  "Smoking",
  "Cleaning",
  "Fines (paid to host)",
  "Gas reimbursement",
  "Gas fee",
  "Other fees",
] as const;

export function parseImportedOrderMetadata(value?: string | null) {
  if (!value) return null;

  try {
    return JSON.parse(value) as ImportedOrderMetadata;
  } catch {
    return null;
  }
}

export function getNetEarningFromFinancials(
  financials?: Record<string, string>,
  fallbackValue?: number | null,
) {
  const totalEarnings = parseNumberValue(financials?.["Total earnings"]);
  const baseValue = totalEarnings ?? fallbackValue ?? null;

  if (baseValue == null) return null;

  const totalExpenses = NET_EARNING_EXPENSE_KEYS.reduce((sum, label) => {
    return sum + (parseNumberValue(financials?.[label]) ?? 0);
  }, 0);

  const airportParkingCredit = parseNumberValue(financials?.["Airport parking credit"]) ?? 0;
  return baseValue - (totalExpenses - airportParkingCredit);
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
