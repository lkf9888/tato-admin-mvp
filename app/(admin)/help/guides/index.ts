import type { Locale } from "@/lib/i18n";
import { convertUiToTraditional } from "@/lib/zh-hant-convert";

import marksFile from "../shots/marks.json";
import type { ShotMarks } from "../shots/types";
import * as en from "./en";
import type { Guide, HelpCopy, ResolvedGuide } from "./types";
import * as zh from "./zh";

export type { Guide, HelpCopy, ResolvedGuide, ResolvedShot } from "./types";

/** Every string in a plain tree, run through `convert`. */
function convertTree<T>(value: T, convert: (text: string) => string): T {
  if (typeof value === "string") return convert(value) as T;
  if (Array.isArray(value)) return value.map((item) => convertTree(item, convert)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, convertTree(item, convert)]),
    ) as T;
  }
  return value;
}

/**
 * The guides and the manual's own words for a locale.
 *
 * Kept out of the app-wide messages on purpose: those ship to every page's
 * browser bundle, and the guides are the longest text in the product but
 * only ever read on /help, where the server renders them. Traditional
 * Chinese is converted from the Simplified text here, with the same
 * converter scripts/generate-zh-hant.ts uses for the rest of the interface.
 */
export function helpContent(locale: Locale): { copy: HelpCopy; guides: Guide[] } {
  if (locale === "en") return { copy: en.copy, guides: en.guides };
  if (locale === "zh-Hant") {
    return {
      copy: convertTree(zh.copy, convertUiToTraditional),
      guides: convertTree(zh.guides, convertUiToTraditional),
    };
  }
  return { copy: zh.copy, guides: zh.guides };
}

/** Which screenshot set to show: the Chinese one for both Chinese locales. */
export function screenshotSet(locale: Locale): "zh" | "en" {
  return locale === "en" ? "en" : "zh";
}

const MARKS = marksFile as Record<string, Partial<Record<"zh" | "en", ShotMarks>>>;

/** Each section's picture and its marks, for one screenshot set. A shot
 *  that was never taken drops out rather than drawing a broken image. */
export function resolveGuides(guides: Guide[], set: "zh" | "en"): ResolvedGuide[] {
  return guides.map((guide) => ({
    ...guide,
    sections: guide.sections.map(({ shot, ...section }) => {
      const taken = shot ? MARKS[shot]?.[set] : undefined;
      return {
        ...section,
        shot: shot && taken ? { src: `/help/shots/${set}/${shot}.jpg`, ...taken } : null,
      };
    }),
  }));
}
