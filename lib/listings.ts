import { type Locale } from "@/lib/i18n";
import { getLocaleTag } from "@/lib/i18n";

export function getListingPath(publicId: string) {
  return `/listing/${publicId}`;
}

export function getListingPhotoUrl(photoId: string) {
  return `/media/${photoId}`;
}

export function splitListingLines(value?: string | null) {
  return (value ?? "")
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function formatBedrooms(value: number) {
  return Number.isInteger(value) ? `${value}` : value.toFixed(1);
}

export function formatBathrooms(value: number) {
  return Number.isInteger(value) ? `${value}` : value.toFixed(1);
}

export function formatArea(value?: number | null, locale: Locale = "en") {
  if (!value) return null;
  return new Intl.NumberFormat(getLocaleTag(locale), {
    maximumFractionDigits: 0,
  }).format(value);
}
