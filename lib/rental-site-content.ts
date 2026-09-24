import type { RentalSite } from "@prisma/client";

import type { SiteLocale } from "@/lib/site-locale";

/**
 * An operator's own words on their site, in each of its languages.
 *
 * The English lives in the RentalSite columns, where it always has; the
 * other two languages sit beside it as JSON. That keeps every existing
 * reader of `site.brandName` working, and means a site nobody translated
 * still renders -- in English -- rather than rendering blanks.
 *
 * Pure. The Traditional fallback conversion is injected by the caller,
 * so this can be tested without OpenCC and imported without dragging
 * its dictionaries anywhere.
 */

export const TRANSLATABLE_FIELDS = [
  "brandName",
  "eyebrow",
  "tagline",
  "description",
  "hours",
  "footerNote",
] as const;
export type TranslatableField = (typeof TRANSLATABLE_FIELDS)[number];

export const MAX_HIGHLIGHTS = 4;

export type SiteHighlight = { value: string; label: string };

type LanguageContent = Partial<Record<TranslatableField, string>> & {
  highlightLabels?: string[];
};

export type SiteTranslations = {
  zh?: LanguageContent;
  "zh-Hant"?: LanguageContent;
};

/** The site with every text field already in one language. */
export type LocalizedSite = RentalSite & {
  locale: SiteLocale;
  highlightItems: SiteHighlight[];
};

function cleanText(value: unknown, max = 1200) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

function readLanguage(value: unknown): LanguageContent | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Record<string, unknown>;
  const out: LanguageContent = {};
  for (const field of TRANSLATABLE_FIELDS) {
    const text = cleanText(source[field]);
    if (text) out[field] = text;
  }
  if (Array.isArray(source.highlightLabels)) {
    out.highlightLabels = source.highlightLabels
      .slice(0, MAX_HIGHLIGHTS)
      .map((label) => cleanText(label, 80) ?? "");
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Never throws: a hand-edited or truncated column reads as "no translations". */
export function parseSiteTranslations(raw: string | null | undefined): SiteTranslations {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: SiteTranslations = {};
    const zh = readLanguage(parsed.zh);
    const hant = readLanguage(parsed["zh-Hant"]);
    if (zh) out.zh = zh;
    if (hant) out["zh-Hant"] = hant;
    return out;
  } catch {
    return {};
  }
}

export function parseHighlights(raw: string | null | undefined): SiteHighlight[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .slice(0, MAX_HIGHLIGHTS)
      .map((item) => ({
        value: cleanText((item as SiteHighlight)?.value, 24) ?? "",
        label: cleanText((item as SiteHighlight)?.label, 80) ?? "",
      }))
      .filter((item) => item.value);
  } catch {
    return [];
  }
}

/**
 * The site as a visitor in `locale` should read it.
 *
 * Each field falls back on its own, not the language as a whole: an
 * operator who translated the headline but not the footer gets a
 * Chinese headline and an English footer, not an all-English page.
 * Traditional falls back to Simplified converted, before English --
 * a Hong Kong visitor reads converted Simplified far more easily than
 * English, and the conversion is the same one the UI's own strings use.
 */
export function localizeSite(
  site: RentalSite,
  locale: SiteLocale,
  toTraditional: (text: string) => string,
): LocalizedSite {
  const translations = parseSiteTranslations(site.translations);
  const highlights = parseHighlights(site.highlights);

  const pick = (field: TranslatableField): string | null => {
    const english = site[field] ?? null;
    if (locale === "en") return english;
    const own = translations[locale]?.[field];
    if (own) return own;
    if (locale === "zh-Hant") {
      const simplified = translations.zh?.[field];
      if (simplified) return toTraditional(simplified);
    }
    return english;
  };

  const pickLabel = (index: number, english: string) => {
    if (locale === "en") return english;
    const own = translations[locale]?.highlightLabels?.[index];
    if (own) return own;
    if (locale === "zh-Hant") {
      const simplified = translations.zh?.highlightLabels?.[index];
      if (simplified) return toTraditional(simplified);
    }
    return english;
  };

  return {
    ...site,
    brandName: pick("brandName") ?? site.brandName,
    eyebrow: pick("eyebrow"),
    tagline: pick("tagline"),
    description: pick("description"),
    hours: pick("hours"),
    footerNote: pick("footerNote"),
    locale,
    highlightItems: highlights.map((item, index) => ({
      value: item.value,
      label: pickLabel(index, item.label),
    })),
  };
}

const FORM_PREFIX = { zh: "zh_", "zh-Hant": "zhHant_" } as const;

/**
 * The content fields of the site settings form, as columns to write.
 *
 * English goes to its own columns; Simplified and Traditional become
 * the `translations` JSON, keeping only what was actually typed so an
 * empty field keeps falling back instead of being pinned to "". Highlight
 * rows need a number to exist -- a label with no number is dropped, and
 * a translated label follows its row even when earlier rows are blank.
 */
export function readSiteContentForm(read: (name: string) => string | null) {
  const text = (name: string, max: number) => {
    const value = read(name)?.trim() ?? "";
    return value ? value.slice(0, max) : null;
  };
  const limits: Record<TranslatableField, number> = {
    brandName: 80,
    eyebrow: 120,
    tagline: 160,
    description: 1200,
    hours: 200,
    footerNote: 1200,
  };

  const rows = Array.from({ length: MAX_HIGHLIGHTS }, (_, index) => ({
    index,
    value: text(`highlightValue_${index}`, 24),
    label: text(`highlightLabel_${index}`, 80) ?? "",
  })).filter((row): row is { index: number; value: string; label: string } => Boolean(row.value));

  const translations: SiteTranslations = {};
  for (const language of ["zh", "zh-Hant"] as const) {
    const prefix = FORM_PREFIX[language];
    const content: LanguageContent = {};
    for (const field of TRANSLATABLE_FIELDS) {
      const value = text(`${prefix}${field}`, limits[field]);
      if (value) content[field] = value;
    }
    const labels = rows.map((row) => text(`${prefix}highlightLabel_${row.index}`, 80) ?? "");
    if (labels.some(Boolean)) content.highlightLabels = labels;
    if (Object.keys(content).length > 0) translations[language] = content;
  }

  return {
    eyebrow: text("eyebrow", limits.eyebrow),
    tagline: text("tagline", limits.tagline),
    description: text("description", limits.description),
    hours: text("hours", limits.hours),
    footerNote: text("footerNote", limits.footerNote),
    highlights: rows.length > 0 ? JSON.stringify(rows.map(({ value, label }) => ({ value, label }))) : null,
    translations: Object.keys(translations).length > 0 ? JSON.stringify(translations) : null,
  };
}
