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
 * then add it to the imports + the `messages` composition below. The
 * Traditional Chinese (`zh-Hant`) variant is computed automatically
 * from the Simplified `zh` block via the SC→TC substitution map.
 */
import { convertMessagesScToTc, convertScToTc } from "@/lib/sc-to-tc";

import { authMessages } from "@/lib/i18n/messages/auth";
import { billingMessages } from "@/lib/i18n/messages/billing";
import { calendarMessages } from "@/lib/i18n/messages/calendar";
import { contactMessages } from "@/lib/i18n/messages/contact";
import { dashboardMessages } from "@/lib/i18n/messages/dashboard";
import { directBookingMessages } from "@/lib/i18n/messages/direct-booking";
import { fleetMessages } from "@/lib/i18n/messages/fleet";
import { importsMessages } from "@/lib/i18n/messages/imports";
import { ordersMessages } from "@/lib/i18n/messages/orders";
import { shareMessages } from "@/lib/i18n/messages/share";
import { shellMessages } from "@/lib/i18n/messages/shell";

export const LOCALE_COOKIE = "turo-locale";

export const supportedLocales = ["en", "zh", "zh-Hant"] as const;

export type Locale = (typeof supportedLocales)[number];

const statusLabelsBase = {
  en: {
    turo: "Turo",
    offline: "Offline",
    cancelled: "Cancelled",
    booked: "Booked",
    ongoing: "Ongoing",
    completed: "Completed",
    available: "Available",
    maintenance: "Maintenance",
    inactive: "Inactive",
    conflict: "Conflict",
    standard: "Standard",
    privacy: "Privacy",
  },
  zh: {
    turo: "Turo",
    offline: "线下",
    cancelled: "已取消",
    booked: "已预订",
    ongoing: "进行中",
    completed: "已完成",
    available: "可用",
    maintenance: "维修中",
    inactive: "停用",
    conflict: "冲突",
    standard: "标准版",
    privacy: "隐私版",
  },
} as const;

type StatusLabelKey = keyof typeof statusLabelsBase["en"];
type StatusLabelMap = Record<StatusLabelKey, string>;

const statusLabels: Record<Locale, StatusLabelMap> = {
  en: statusLabelsBase.en,
  zh: statusLabelsBase.zh,
  "zh-Hant": convertMessagesScToTc(statusLabelsBase.zh) as StatusLabelMap,
};

// Canonical list of every `action` string written by `logActivity`
// across the codebase. Sources audited: `app/actions.ts`, the `app/api/*`
// routes, `lib/orders.ts`, `lib/direct-booking-server.ts`. If you add
// a new logActivity call, add the string here too — the activity log
// page reads from this map to populate the action filter dropdown,
// and an unlisted action falls back to a raw underscore-separated
// string in the UI.
const activityLabelsBase = {
  en: {
    user_registered: "User registered",
    password_reset: "Password reset",
    owner_created: "Owner created",
    owner_updated: "Owner updated",
    owner_deleted: "Owner deleted",
    vehicle_created: "Vehicle created",
    vehicle_updated: "Vehicle updated",
    vehicle_deleted: "Vehicle deleted",
    vehicle_purchase_price_updated: "Vehicle purchase price updated",
    vehicle_direct_booking_updated: "Vehicle booking settings updated",
    vehicle_auto_created_from_csv: "Vehicle auto-created from CSV",
    offline_order_created: "Offline order created",
    offline_order_updated: "Offline order updated",
    offline_order_deleted: "Offline order deleted",
    order_status_updated: "Order status updated",
    order_notes_updated: "Order notes updated",
    import_csv: "CSV imported",
    share_link_created: "Share link created",
    share_link_revoked: "Share link revoked",
    share_link_deleted: "Share link deleted",
    feedback_submitted: "Feedback submitted",
    direct_booking_order_created: "Direct booking order created",
    direct_booking_refund_failed: "Direct booking refund failed",
    direct_booking_metadata_missing: "Direct booking metadata missing",
    direct_booking_vehicle_missing: "Direct booking vehicle missing",
    direct_booking_workspace_missing: "Direct booking workspace missing",
    direct_booking_conflict_refunded: "Direct booking conflict refunded",
  },
  zh: {
    user_registered: "已注册用户",
    password_reset: "已重置密码",
    owner_created: "已创建车主",
    owner_updated: "已更新车主",
    owner_deleted: "已删除车主",
    vehicle_created: "已创建车辆",
    vehicle_updated: "已更新车辆",
    vehicle_deleted: "已删除车辆",
    vehicle_purchase_price_updated: "已更新车辆购买价",
    vehicle_direct_booking_updated: "已更新车辆在线预定设置",
    vehicle_auto_created_from_csv: "CSV 自动建档车辆",
    offline_order_created: "已创建线下订单",
    offline_order_updated: "已更新线下订单",
    offline_order_deleted: "已删除线下订单",
    order_status_updated: "已更新订单状态",
    order_notes_updated: "已更新订单备注",
    import_csv: "已导入 CSV",
    share_link_created: "已创建共享链接",
    share_link_revoked: "已作废共享链接",
    share_link_deleted: "已删除共享链接",
    feedback_submitted: "已提交反馈",
    direct_booking_order_created: "已创建在线预订订单",
    direct_booking_refund_failed: "在线预订退款失败",
    direct_booking_metadata_missing: "在线预订元数据缺失",
    direct_booking_vehicle_missing: "在线预订车辆缺失",
    direct_booking_workspace_missing: "在线预订工作台缺失",
    direct_booking_conflict_refunded: "在线预订冲突已退款",
  },
} as const;

type ActivityLabelKey = keyof typeof activityLabelsBase["en"];
type ActivityLabelMap = Record<ActivityLabelKey, string>;

const activityLabels: Record<Locale, ActivityLabelMap> = {
  en: activityLabelsBase.en,
  zh: activityLabelsBase.zh,
  "zh-Hant": convertMessagesScToTc(activityLabelsBase.zh) as ActivityLabelMap,
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
    ...contactMessages.en,
    ...authMessages.en,
    ...dashboardMessages.en,
    ...fleetMessages.en,
    ...directBookingMessages.en,
    ...ordersMessages.en,
    ...importsMessages.en,
    ...billingMessages.en,
    ...calendarMessages.en,
    ...shareMessages.en,
  },
  zh: {
    ...shellMessages.zh,
    ...contactMessages.zh,
    ...authMessages.zh,
    ...dashboardMessages.zh,
    ...fleetMessages.zh,
    ...directBookingMessages.zh,
    ...ordersMessages.zh,
    ...importsMessages.zh,
    ...billingMessages.zh,
    ...calendarMessages.zh,
    ...shareMessages.zh,
  },
} as const;

export type Messages = (typeof messages)["zh"];

// Traditional Chinese is computed from the Simplified zh block at module
// load via a per-character substitution map (see lib/sc-to-tc.ts). The
// converter preserves functions and non-string values, so message getters
// like `quoteDays(count)` keep working unchanged. About 95% of admin UI
// text converts cleanly with this approach; for the remaining ~5% that
// needs context-sensitive Traditional forms (e.g. 系統 vs 聯繫), tweak
// the SC_TO_TC map in lib/sc-to-tc.ts or override here.
const traditionalMessages = convertMessagesScToTc(messages.zh) as Messages;

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

// Re-exported here so callers don't need to import sc-to-tc directly when
// they want to translate ad-hoc DB strings (e.g. owner names) to TC.
export { convertScToTc };
