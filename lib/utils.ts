import { clsx, type ClassValue } from "clsx";

import { getLocaleTag, type Locale } from "@/lib/i18n";

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export function formatDateTime(value: Date | string, locale: Locale = "en") {
  return new Intl.DateTimeFormat(getLocaleTag(locale), {
    month: locale === "zh" ? "numeric" : "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: locale !== "zh",
  }).format(new Date(value));
}

export function formatDate(value: Date | string, locale: Locale = "en") {
  return new Intl.DateTimeFormat(getLocaleTag(locale), {
    month: locale === "zh" ? "numeric" : "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
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
  const metadata = parseImportedOrderMetadata(sourceMetadata);
  return getNetEarningFromFinancials(metadata?.financials, fallbackValue);
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
