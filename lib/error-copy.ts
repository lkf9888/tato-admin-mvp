/**
 * The words on the error, crash and 404 pages, in the three languages
 * the admin speaks. Kept apart from lib/i18n so the crash page -- which
 * runs when the app itself has failed -- depends on nothing but this.
 */

export type ErrorLocale = "zh" | "zh-Hant" | "en";

export const ERROR_COPY = {
  zh: {
    errorTitle: "这个页面没能加载出来",
    errorBody: "是平台出了问题，不是你的操作有误。你的数据没有受影响。",
    retry: "重新加载",
    home: "回到首页",
    digest: "如果反复出现，把这个编号发给技术支持：",
    crashTitle: "平台暂时无法加载",
    crashBody: "我们已经记录了这个问题。你的数据没有受影响。",
    crashDigest: "编号",
    notFoundTitle: "找不到这个页面",
    notFoundBody: "它可能已经被删除，或者链接本身就是错的。",
  },
  "zh-Hant": {
    errorTitle: "這個頁面沒能載入",
    errorBody: "是平台出了問題，不是你的操作有誤。你的資料沒有受影響。",
    retry: "重新載入",
    home: "回到首頁",
    digest: "如果反覆出現，請把這個編號發給技術支援：",
    crashTitle: "平台暫時無法載入",
    crashBody: "我們已經記錄了這個問題。你的資料沒有受影響。",
    crashDigest: "編號",
    notFoundTitle: "找不到這個頁面",
    notFoundBody: "它可能已經被刪除，或者連結本身就是錯的。",
  },
  en: {
    errorTitle: "This page didn't load",
    errorBody: "Something went wrong on our side, not anything you did. Your data is unaffected.",
    retry: "Try again",
    home: "Go to the dashboard",
    digest: "If it keeps happening, send support this code:",
    crashTitle: "TATO can't load right now",
    crashBody: "We've logged the problem. Your data is unaffected.",
    crashDigest: "Code",
    notFoundTitle: "Page not found",
    notFoundBody: "It may have been deleted, or the link was wrong to begin with.",
  },
} as const;

/** From an `<html lang>` or a browser language: zh-Hant/zh-TW/zh-HK, other zh, or English. */
export function errorLocaleFrom(tag: string | null | undefined): ErrorLocale {
  const value = (tag ?? "").toLowerCase();
  if (/^zh-(hant|tw|hk|mo)/.test(value)) return "zh-Hant";
  if (value.startsWith("zh")) return "zh";
  return "en";
}
