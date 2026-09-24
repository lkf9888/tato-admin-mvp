/**
 * Public i18n surface.
 *
 * This file owns the type system + helpers (locale parsing, status
 * labels, activity-log labels, dropdown option builders) and stitches
 * the per-page message blocks under `lib/i18n/messages/*` into one
 * `messages` object. Pages and components import from here unchanged.
 *
 * To add a new page's strings, create a new file in
 * `lib/i18n/messages/` exporting `{ en: {...}, zh: {...} } as const`,
 * add it to the imports + the `messages` composition below, and run
 * `npx tsx scripts/generate-zh-hant.ts` to produce its Traditional
 * Chinese (`zh-Hant`) block.
 */
import { activityLabelsBase, statusLabelsBase } from "@/lib/i18n/messages/labels";
import * as zhHant from "@/lib/i18n/zh-hant";

import { accountSettingsMessages } from "@/lib/i18n/messages/account-settings";
import { assistantMessages } from "@/lib/i18n/messages/assistant";
import { guestMessagesMessages } from "@/lib/i18n/messages/guest-messages";
import { orderDetailMessages } from "@/lib/i18n/messages/order-detail";
import { turoUpdatesMessages } from "@/lib/i18n/messages/turo-updates";
import { authMessages } from "@/lib/i18n/messages/auth";
import { bookingMessages } from "@/lib/i18n/messages/booking";
import { billingMessages } from "@/lib/i18n/messages/billing";
import { calendarMessages } from "@/lib/i18n/messages/calendar";
import { contactMessages } from "@/lib/i18n/messages/contact";
import { dashboardMessages } from "@/lib/i18n/messages/dashboard";
import { directBookingMessages } from "@/lib/i18n/messages/direct-booking";
import { fleetMessages } from "@/lib/i18n/messages/fleet";
import { importsMessages } from "@/lib/i18n/messages/imports";
import { inspectionsMessages } from "@/lib/i18n/messages/inspections";
import { investmentRankingMessages } from "@/lib/i18n/messages/investment-ranking";
import { ordersMessages } from "@/lib/i18n/messages/orders";
import { rentalEstimateMessages } from "@/lib/i18n/messages/rental-estimate";
import { rentalSiteMessages } from "@/lib/i18n/messages/rental-site";
import { shareMessages } from "@/lib/i18n/messages/share";
import { shellMessages } from "@/lib/i18n/messages/shell";

export const LOCALE_COOKIE = "turo-locale";

export const supportedLocales = ["en", "zh", "zh-Hant"] as const;

export type Locale = (typeof supportedLocales)[number];


type StatusLabelKey = keyof typeof statusLabelsBase["en"];
type StatusLabelMap = Record<StatusLabelKey, string>;

const statusLabels: Record<Locale, StatusLabelMap> = {
  en: statusLabelsBase.en,
  zh: statusLabelsBase.zh,
  "zh-Hant": zhHant.statusLabelsBase as StatusLabelMap,
};


type ActivityLabelKey = keyof typeof activityLabelsBase["en"];
type ActivityLabelMap = Record<ActivityLabelKey, string>;

const activityLabels: Record<Locale, ActivityLabelMap> = {
  en: activityLabelsBase.en,
  zh: activityLabelsBase.zh,
  "zh-Hant": zhHant.activityLabelsBase as ActivityLabelMap,
};

export function resolveLocale(value?: string | null): Locale {
  if (value === "zh") return "zh";
  if (value === "zh-Hant" || value === "zh-TW" || value === "zh-HK") return "zh-Hant";
  return "en";
}

export function getLocaleTag(locale: Locale) {
  if (locale === "zh") return "zh-CN";
  if (locale === "zh-Hant") return "zh-Hant";
  return "en-CA";
}

export function getStatusLabel(value: string, locale: Locale) {
  return statusLabels[locale][value as StatusLabelKey] ?? value;
}

export function getActivityActionLabel(action: string, locale: Locale) {
  return activityLabels[locale][action as ActivityLabelKey] ?? action.replaceAll("_", " ");
}

/** Canonical (action-key, label) list for the /activity filter dropdown. */
export function getActivityActionOptions(
  locale: Locale,
): Array<{ value: ActivityLabelKey; label: string }> {
  return (Object.keys(activityLabelsBase.en) as ActivityLabelKey[]).map((key) => ({
    value: key,
    label: activityLabels[locale][key],
  }));
}

/** EntityType strings actually written by `logActivity` calls — used
 *  to build the entityType filter dropdown on /activity. */
export const ACTIVITY_ENTITY_TYPES = [
  "User",
  "Owner",
  "Vehicle",
  "Order",
  "ImportBatch",
  "ShareLink",
  "Feedback",
  "Workspace",
  "WorkspaceBilling",
] as const;
export type ActivityEntityType = (typeof ACTIVITY_ENTITY_TYPES)[number];

export function getOrderStatusOptions(locale: Locale) {
  return [
    { value: "booked", label: getStatusLabel("booked", locale) },
    { value: "ongoing", label: getStatusLabel("ongoing", locale) },
    { value: "completed", label: getStatusLabel("completed", locale) },
    { value: "cancelled", label: getStatusLabel("cancelled", locale) },
  ] as const;
}

export function getVehicleStatusOptions(locale: Locale) {
  return [
    { value: "available", label: getStatusLabel("available", locale) },
    { value: "maintenance", label: getStatusLabel("maintenance", locale) },
    { value: "inactive", label: getStatusLabel("inactive", locale) },
  ] as const;
}

export function getShareVisibilityOptions(locale: Locale) {
  return [
    { value: "standard", label: getStatusLabel("standard", locale) },
    { value: "privacy", label: getStatusLabel("privacy", locale) },
  ] as const;
}

export function getCsvFieldOptions(locale: Locale) {
  if (locale === "zh") {
    return [
      { value: "vehicleLabel", label: "车辆 / 车牌标识" },
      { value: "vehicleName", label: "车辆名称" },
      { value: "externalVehicleId", label: "车辆 ID" },
      { value: "vin", label: "VIN" },
      { value: "renterName", label: "租客姓名" },
      { value: "renterPhone", label: "电话" },
      { value: "pickupDatetime", label: "取车时间" },
      { value: "returnDatetime", label: "还车时间" },
      { value: "pickupLocation", label: "取车地点" },
      { value: "returnLocation", label: "还车地点" },
      { value: "tripPrice", label: "Trip price" },
      { value: "totalEarnings", label: "Total earnings" },
      { value: "totalPrice", label: "备用总金额" },
      { value: "externalOrderId", label: "Reservation ID" },
      { value: "status", label: "订单状态" },
    ] as const;
  }

  return [
    { value: "vehicleLabel", label: "Vehicle / Plate label" },
    { value: "vehicleName", label: "Vehicle name" },
    { value: "externalVehicleId", label: "Vehicle id" },
    { value: "vin", label: "VIN" },
    { value: "renterName", label: "Guest / Renter name" },
    { value: "renterPhone", label: "Phone" },
    { value: "pickupDatetime", label: "Trip Start" },
    { value: "returnDatetime", label: "Trip End" },
    { value: "pickupLocation", label: "Pickup location" },
    { value: "returnLocation", label: "Return location" },
    { value: "tripPrice", label: "Trip price" },
    { value: "totalEarnings", label: "Total earnings" },
    { value: "totalPrice", label: "Fallback total price" },
    { value: "externalOrderId", label: "Reservation ID" },
    { value: "status", label: "Trip status" },
  ] as const;
}

// Compose the messages object from per-page modules. Each module
// exports `{ en: {...}, zh: {...} } as const` with top-level keys
// matching the destination shape, so the spread idiom keeps the
// composition compact while preserving literal types — same behavior
// as inlining all keys at once.
const messages = {
  en: {
    ...shellMessages.en,
    ...inspectionsMessages.en,
    ...accountSettingsMessages.en,
    ...contactMessages.en,
    ...assistantMessages.en,
    ...guestMessagesMessages.en,
    ...orderDetailMessages.en,
    ...turoUpdatesMessages.en,
    ...authMessages.en,
    ...dashboardMessages.en,
    ...fleetMessages.en,
    ...directBookingMessages.en,
    ...ordersMessages.en,
    ...rentalEstimateMessages.en,
    ...rentalSiteMessages.en,
    ...importsMessages.en,
    ...investmentRankingMessages.en,
    ...billingMessages.en,
    ...bookingMessages.en,
    ...calendarMessages.en,
    ...shareMessages.en,
  },
  zh: {
    ...shellMessages.zh,
    ...inspectionsMessages.zh,
    ...accountSettingsMessages.zh,
    ...contactMessages.zh,
    ...assistantMessages.zh,
    ...guestMessagesMessages.zh,
    ...orderDetailMessages.zh,
    ...turoUpdatesMessages.zh,
    ...authMessages.zh,
    ...dashboardMessages.zh,
    ...fleetMessages.zh,
    ...directBookingMessages.zh,
    ...ordersMessages.zh,
    ...rentalEstimateMessages.zh,
    ...rentalSiteMessages.zh,
    ...importsMessages.zh,
    ...investmentRankingMessages.zh,
    ...billingMessages.zh,
    ...bookingMessages.zh,
    ...calendarMessages.zh,
    ...shareMessages.zh,
  },
} as const;

export type Messages = (typeof messages)["zh"];

// Traditional Chinese is generated, not computed: scripts/generate-zh-hant.ts
// runs OpenCC over the source of every `zh` block and writes the result
// to lib/i18n/zh-hant/, which CI checks is up to date. That converts the
// text inside message functions too, which a runtime pass over values
// never could -- functions came through it untouched, so every
// parameterised string in the Traditional UI used to render Simplified.
const traditionalMessages = {
  ...zhHant.shellMessages,
  ...zhHant.inspectionsMessages,
  ...zhHant.accountSettingsMessages,
  ...zhHant.contactMessages,
  ...zhHant.assistantMessages,
  ...zhHant.guestMessagesMessages,
  ...zhHant.orderDetailMessages,
  ...zhHant.turoUpdatesMessages,
  ...zhHant.authMessages,
  ...zhHant.dashboardMessages,
  ...zhHant.fleetMessages,
  ...zhHant.directBookingMessages,
  ...zhHant.ordersMessages,
  ...zhHant.rentalEstimateMessages,
  ...zhHant.rentalSiteMessages,
  ...zhHant.importsMessages,
  ...zhHant.investmentRankingMessages,
  ...zhHant.billingMessages,
  ...zhHant.bookingMessages,
  ...zhHant.calendarMessages,
  ...zhHant.shareMessages,
} as unknown as Messages;

// Cast through `unknown` because messages.en / messages.zh have different
// literal-string types from `as const`, even though their shapes match.
const messagesByLocale: Record<Locale, Messages> = {
  en: messages.en as unknown as Messages,
  zh: messages.zh as Messages,
  "zh-Hant": traditionalMessages,
};

export function getMessages(locale: Locale): Messages {
  return messagesByLocale[locale];
}
