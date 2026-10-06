import { VEHICLE_FEATURE_LABELS, type VehicleFeature } from "@/lib/vehicle-features";

/**
 * Classified-ad drafts for one car, for VanPeople, Facebook and
 * Craigslist.
 *
 * Pure: facts in, drafts out, no network and no AI, so what an ad says
 * is exactly what the facts say. None of these sites has a posting API
 * a small operator can use, so the deliverable is text a person pastes,
 * and every ad links back to the car's page on the operator's own site
 * -- that is where the booking happens. (Shape ported from HostHub's
 * listing adapters.)
 */

export const AD_PLATFORMS = ["vanpeople", "facebook", "craigslist"] as const;
export type AdPlatform = (typeof AD_PLATFORMS)[number];

export type AdFacts = {
  brand: string;
  model: string;
  year: number;
  features: VehicleFeature[];
  /** The operator's own description of the car, as written. */
  intro: string | null;
  /** Per day with insurance folded in, as the site shows it. Null: no price. */
  dailyFrom: number | null;
  weeklyDiscountPercent: number;
  minimumRentalDays: number;
  dailyKmAllowance: number;
  extraKmRate: number;
  depositAmount: number;
  location: string | null;
  /** The car's page on the operator's site; null when it is not on a published site. */
  carUrl: string | null;
  photoCount: number;
  brandName: string;
  phone: string | null;
  wechat: string | null;
};

export type AdWarning = {
  /** `blocker`: the ad cannot be posted correctly yet. `lossy`: something was cut to fit. */
  severity: "blocker" | "lossy";
  code: "no_price" | "no_link" | "no_photos" | "title_cut" | "intro_language";
};

export type AdDraft = {
  platform: AdPlatform;
  locale: "zh" | "en";
  title: string;
  titleLimit: number;
  body: string;
  /** Values for the platform's own form fields, where it has them. */
  fields: Array<{ label: string; value: string }>;
  warnings: AdWarning[];
};

/** Where each site cuts a title. VanPeople's is the softest figure. */
export const AD_TITLE_LIMITS: Record<AdPlatform, number> = {
  vanpeople: 30,
  facebook: 100,
  craigslist: 70,
};

function money(value: number) {
  return `$${Number.isInteger(value) ? value : value.toFixed(2)}`;
}

/** Title from tokens in priority order, as many as fit. */
function fitTitle(tokens: string[], limit: number, separator: string) {
  let title = "";
  let cut = false;
  for (const token of tokens.filter(Boolean)) {
    const next = title ? `${title}${separator}${token}` : token;
    if ([...next].length <= limit) title = next;
    else cut = true;
  }
  return { title, cut };
}

function blockers(facts: AdFacts): AdWarning[] {
  return [
    ...(facts.dailyFrom == null ? [{ severity: "blocker" as const, code: "no_price" as const }] : []),
    ...(facts.carUrl ? [] : [{ severity: "blocker" as const, code: "no_link" as const }]),
    ...(facts.photoCount === 0 ? [{ severity: "blocker" as const, code: "no_photos" as const }] : []),
  ];
}

/**
 * The car has one description, in whatever language the operator wrote
 * it. It goes into the ads in that language only: an English paragraph
 * in a Chinese post reads as a copy-paste.
 */
function introFor(facts: AdFacts, locale: "zh" | "en") {
  if (!facts.intro) return null;
  const chinese = /[\u3400-\u9fff]/.test(facts.intro);
  return chinese === (locale === "zh") ? facts.intro : null;
}

function zhBody(facts: AdFacts) {
  const features = facts.features.map((feature) => VEHICLE_FEATURE_LABELS.zh[feature]);
  return [
    `${facts.year} ${facts.brand} ${facts.model} 出租`,
    facts.dailyFrom != null ? `每天 ${money(facts.dailyFrom)} 起，已含保险。` : null,
    facts.weeklyDiscountPercent > 0 ? `租满 7 天打 ${(100 - facts.weeklyDiscountPercent) / 10} 折（减 ${facts.weeklyDiscountPercent}%）。` : null,
    "",
    features.length ? `· ${features.join("、")}` : null,
    facts.dailyKmAllowance > 0 ? `· 每天含 ${facts.dailyKmAllowance} 公里，超出 ${money(facts.extraKmRate)}/公里` : null,
    facts.depositAmount > 0 ? `· 押金 ${money(facts.depositAmount)}，还车后退还` : null,
    facts.minimumRentalDays > 1 ? `· 最少租 ${facts.minimumRentalDays} 天` : null,
    facts.location ? `· 取车地点：${facts.location}` : null,
    introFor(facts, "zh") ? `\n${introFor(facts, "zh")}` : null,
    "",
    facts.carUrl ? `在线预订、查看空档：${facts.carUrl}` : null,
    [facts.brandName, facts.phone, facts.wechat ? `微信 ${facts.wechat}` : null].filter(Boolean).join(" · "),
  ]
    .filter((line) => line !== null)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function enBody(facts: AdFacts) {
  const features = facts.features.map((feature) => VEHICLE_FEATURE_LABELS.en[feature]);
  return [
    `${facts.year} ${facts.brand} ${facts.model} for rent`,
    facts.dailyFrom != null ? `From ${money(facts.dailyFrom)}/day, insurance included.` : null,
    facts.weeklyDiscountPercent > 0 ? `${facts.weeklyDiscountPercent}% off for 7 days or more.` : null,
    "",
    features.length ? `• ${features.join(", ")}` : null,
    facts.dailyKmAllowance > 0 ? `• ${facts.dailyKmAllowance} km/day included, ${money(facts.extraKmRate)}/km after that` : null,
    facts.depositAmount > 0 ? `• ${money(facts.depositAmount)} deposit, returned after the trip` : null,
    facts.minimumRentalDays > 1 ? `• ${facts.minimumRentalDays}-day minimum` : null,
    facts.location ? `• Pick-up: ${facts.location}` : null,
    introFor(facts, "en") ? `\n${introFor(facts, "en")}` : null,
    "",
    facts.carUrl ? `See dates and book online: ${facts.carUrl}` : null,
    [facts.brandName, facts.phone, facts.wechat ? `WeChat ${facts.wechat}` : null].filter(Boolean).join(" · "),
  ]
    .filter((line) => line !== null)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function buildAdDraft(platform: AdPlatform, facts: AdFacts): AdDraft {
  const limit = AD_TITLE_LIMITS[platform];
  const warnings = blockers(facts);
  if (facts.intro && !introFor(facts, platform === "vanpeople" ? "zh" : "en")) {
    warnings.push({ severity: "lossy", code: "intro_language" });
  }
  const car = `${facts.year} ${facts.brand} ${facts.model}`;
  const price = facts.dailyFrom != null ? money(facts.dailyFrom) : null;

  if (platform === "vanpeople") {
    const { title, cut } = fitTitle(
      [
        `${car} 出租`,
        price ? `${price}/天起` : "",
        facts.features.includes("seats7") ? "7座" : "",
        facts.features.includes("awd") ? "四驱" : "",
        "含保险",
      ],
      limit,
      " ",
    );
    if (cut) warnings.push({ severity: "lossy", code: "title_cut" });
    return {
      platform,
      locale: "zh",
      title,
      titleLimit: limit,
      body: zhBody(facts),
      fields: [
        ...(price ? [{ label: "价格", value: `${price}/天` }] : []),
        ...(facts.location ? [{ label: "地区", value: facts.location }] : []),
        ...(facts.phone ? [{ label: "电话", value: facts.phone }] : []),
        ...(facts.wechat ? [{ label: "微信", value: facts.wechat }] : []),
      ],
      warnings,
    };
  }

  const { title, cut } = fitTitle(
    [
      `${car} for rent`,
      price ? `from ${price}/day` : "",
      "insurance included",
      facts.features.includes("seats7") ? "7 seats" : "",
      facts.features.includes("awd") ? "AWD" : "",
    ],
    limit,
    platform === "craigslist" ? " - " : " · ",
  );
  if (cut) warnings.push({ severity: "lossy", code: "title_cut" });
  return {
    platform,
    locale: "en",
    title,
    titleLimit: limit,
    body: enBody(facts),
    fields: [
      ...(price ? [{ label: "Price", value: price }] : []),
      ...(facts.location ? [{ label: platform === "craigslist" ? "City or neighborhood" : "Location", value: facts.location }] : []),
    ],
    warnings,
  };
}

/**
 * Number tokens in a text, normalised ("1,000" and "1000" are one).
 * Links are left out -- the digits in a car's id would otherwise hide an
 * invented "5" -- and checked whole on their own.
 */
function numbersIn(text: string) {
  const prose = text.replace(/https?:\/\/\S+/g, " ");
  return new Set((prose.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((token) => token.replace(/,/g, "")));
}

/**
 * Whether an AI rewrite can be trusted in place of the draft: the title
 * fits, the link survives, and the numbers are exactly the draft's --
 * none lost (a price, a deposit, a kilometre allowance) and none
 * invented. Anything else is a lie told to strangers on the operator's
 * behalf, so the caller keeps the draft.
 */
export function verifyAdRewrite(draft: AdDraft, rewrite: { title: string; body: string }): string | null {
  if (!rewrite.title.trim() || !rewrite.body.trim()) return "empty";
  if ([...rewrite.title].length > draft.titleLimit) return "title_too_long";
  const url = draft.body.match(/https?:\/\/\S+/)?.[0];
  if (url && !rewrite.body.includes(url)) return "link_missing";
  const before = numbersIn(`${draft.title}\n${draft.body}`);
  const after = numbersIn(`${rewrite.title}\n${rewrite.body}`);
  for (const number of before) if (!after.has(number)) return `number_missing:${number}`;
  for (const number of after) if (!before.has(number)) return `number_added:${number}`;
  return null;
}
