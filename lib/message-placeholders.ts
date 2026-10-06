/**
 * Placeholders in message templates, and whether a template has already
 * been sent in a conversation.
 *
 * Pure functions, shared by the template panel (client) and anything on
 * the server that wants the same rendering.
 */

export const PLACEHOLDER_KEYS = [
  "guest",
  "guest_first_name",
  "car",
  "plate",
  "pickup",
  "return",
  "pickup_location",
  "return_location",
  "reservation",
  "pickup_code",
] as const;

export type PlaceholderKey = (typeof PLACEHOLDER_KEYS)[number];

export const PLACEHOLDER_LABELS: Record<PlaceholderKey, { zh: string; en: string }> = {
  guest: { zh: "客人全名", en: "Guest name" },
  guest_first_name: { zh: "客人名", en: "Guest first name" },
  car: { zh: "车型", en: "Car" },
  plate: { zh: "车牌", en: "Plate" },
  pickup: { zh: "取车时间", en: "Pickup time" },
  return: { zh: "还车时间", en: "Return time" },
  pickup_location: { zh: "取车地点", en: "Pickup location" },
  return_location: { zh: "还车地点", en: "Return location" },
  reservation: { zh: "预订号", en: "Reservation" },
  pickup_code: { zh: "取车密码", en: "Pickup code" },
};

/** What one conversation can fill in. Dates stay dates until rendered,
 *  because the template's own language decides how they read. */
export type PlaceholderContext = {
  guest?: string | null;
  car?: string | null;
  plate?: string | null;
  pickup?: string | Date | null;
  return?: string | Date | null;
  pickupLocation?: string | null;
  returnLocation?: string | null;
  reservation?: string | null;
  pickupCode?: string | null;
};

const TOKEN = /\{\{\s*([a-z_]+)\s*\}\}/g;
const CJK = /[㐀-鿿]/;

function formatWhen(value: string | Date, chinese: boolean) {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return null;
  if (chinese) {
    const weekday = date.toLocaleDateString("zh-CN", { weekday: "short" });
    const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
    return `${date.getMonth() + 1}月${date.getDate()}日 ${weekday} ${time}`;
  }
  return date.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function valueFor(key: PlaceholderKey, context: PlaceholderContext, chinese: boolean): string | null {
  const clean = (value: string | null | undefined) => (value && value.trim() ? value.trim() : null);
  switch (key) {
    case "guest":
      return clean(context.guest);
    case "guest_first_name":
      return clean(context.guest)?.split(/\s+/)[0] ?? null;
    case "car":
      return clean(context.car);
    case "plate":
      return clean(context.plate);
    case "pickup":
      return context.pickup ? formatWhen(context.pickup, chinese) : null;
    case "return":
      return context.return ? formatWhen(context.return, chinese) : null;
    case "pickup_location":
      return clean(context.pickupLocation);
    case "return_location":
      return clean(context.returnLocation);
    case "reservation":
      return clean(context.reservation);
    case "pickup_code":
      return clean(context.pickupCode);
  }
}

/**
 * Fill a template's placeholders from a conversation.
 *
 * A placeholder that cannot be filled -- an unknown name, or a fact this
 * trip does not have -- is left in the text as written and listed in
 * `missing`. Blanking it would send "Your car is at  , code " to a guest
 * with nothing to show it was ever meant to say something.
 *
 * Dates are written in the template's own language: a template with any
 * Chinese in it gets Chinese dates, anything else English, since that is
 * what the guest reading it expects.
 */
export function renderTemplate(content: string, context: PlaceholderContext | null) {
  const chinese = CJK.test(content.replace(TOKEN, ""));
  const missing = new Set<string>();
  const text = content.replace(TOKEN, (whole, name: string) => {
    if (!context || !(PLACEHOLDER_KEYS as readonly string[]).includes(name)) {
      missing.add(name);
      return whole;
    }
    const value = valueFor(name as PlaceholderKey, context, chinese);
    if (value == null) {
      missing.add(name);
      return whole;
    }
    return value;
  });
  return { text, missing: [...missing] };
}

export function hasPlaceholders(content: string) {
  TOKEN.lastIndex = 0;
  return TOKEN.test(content);
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

/** Shortest fixed stretch of a template worth matching on: shorter than
 *  this, "Thanks!" would match half of every conversation. */
const MIN_MATCH_CHARS = 16;

/**
 * Whether this template already went out in the conversation.
 *
 * Compared on the template's longest fixed stretch -- the words between
 * placeholders -- because what was sent had the placeholders filled in,
 * and the guest's name or a date will not match the template text.
 * Punctuation and spacing are ignored, since a copied message is often
 * tidied before it is sent.
 */
export function templateAlreadySent(content: string, sentMessages: string[]) {
  if (sentMessages.length === 0) return false;
  const longest = content
    .split(TOKEN)
    .filter((_, index) => index % 2 === 0)
    .map(normalize)
    .sort((a, b) => b.length - a.length)[0];
  if (!longest || longest.length < MIN_MATCH_CHARS) return false;
  // A long fixed stretch is matched on its middle, so an edit to how it
  // starts or ends still counts as the same template.
  const probe =
    longest.length > 60 ? longest.slice(Math.floor(longest.length / 2) - 30, Math.floor(longest.length / 2) + 30) : longest;
  return sentMessages.some((message) => normalize(message).includes(probe));
}
