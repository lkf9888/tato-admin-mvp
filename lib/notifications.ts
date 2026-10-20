/**
 * What TATO can notify about, and the names the settings page shows.
 *
 * Pure data, shared by the settings section (client) and the senders
 * (server). Each subscribed browser keeps its own choice of these
 * (`WebPushSubscription.categories`), so a phone can take guest messages
 * while the office computer takes everything.
 *
 * Adding a category: add it here, then call `notifyCategory` (in
 * lib/web-push) where the event happens. A device that never chose
 * (categories null) gets every category, the new one included.
 */

export const NOTIFICATION_CATEGORIES = [
  {
    key: "guest_messages",
    zh: "新客人消息",
    en: "New guest messages",
    zhHint: "客人在 Turo 上发来消息时，15 分钟内的多条合成一条。",
    enHint: "When a guest writes on Turo; messages within 15 minutes go out together.",
  },
  {
    key: "bookings",
    zh: "预订变动",
    en: "Booking changes",
    zhHint: "Turo 来了新预订，或有订单被取消。",
    enHint: "A new Turo booking arrives, or a trip is cancelled.",
  },
  {
    key: "alerts",
    zh: "运营提醒",
    en: "Operations alerts",
    zhHint: "订单冲突、客人消息久未回复、任务逾期、取车前没准备好、导入失败等需要处理的事。",
    enHint: "Double bookings, guests left unanswered, overdue tasks, pickups not prepared, failed imports.",
  },
  {
    key: "turo_support",
    zh: "Turo 客服与理赔",
    en: "Turo support & claims",
    zhHint: "Turo 客服回复、理赔进度、车辆被下架或重新上架。",
    enHint: "Replies from Turo support, claim updates, a car delisted or relisted.",
  },
  {
    key: "payments",
    zh: "收入与报销",
    en: "Earnings & reimbursements",
    zhHint: "收入到账、报销单开出、客人已付或未付报销。",
    enHint: "Payouts sent, reimbursement invoices raised, paid or unanswered.",
  },
  {
    key: "reviews",
    zh: "客人评分",
    en: "Guest ratings",
    zhHint: "客人给行程打了分。",
    enHint: "A guest rated their trip.",
  },
  {
    key: "staff_tasks",
    zh: "员工任务",
    en: "Staff tasks",
    zhHint: "员工完成任务、留言或上传照片。",
    enHint: "Staff finish a task, leave a note or upload photos.",
  },
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number]["key"];

export const ALL_CATEGORIES: NotificationCategory[] = NOTIFICATION_CATEGORIES.map((category) => category.key);

export function isNotificationCategory(value: string): value is NotificationCategory {
  return (ALL_CATEGORIES as string[]).includes(value);
}

/** A device's stored choice, read leniently: null or unreadable means all. */
export function parseCategories(raw: string | null | undefined): NotificationCategory[] {
  if (!raw) return ALL_CATEGORIES;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return ALL_CATEGORIES;
    return parsed.filter((value): value is NotificationCategory => typeof value === "string" && isNotificationCategory(value));
  } catch {
    return ALL_CATEGORIES;
  }
}
