/**
 * Simplified → Traditional (Taiwan standard, Taiwan phrasing), via OpenCC.
 *
 * One converter for two jobs: scripts/generate-zh-hant.ts uses it to
 * write the UI's Traditional message files, and the rental site uses it
 * at render time for an operator's own words when they wrote Simplified
 * and left Traditional blank. Same rules for both, so the site's chrome
 * and its content never disagree about how a word is written.
 *
 * Not for client components: OpenCC's dictionaries are large, and
 * nothing in a browser needs them -- the UI's Traditional text is
 * already generated.
 */
import * as OpenCC from "opencc-js";

/** Characters plus Taiwan vocabulary (登录→登入, 视频→影片). */
const toTaiwanPhrasing = OpenCC.Converter({ from: "cn", to: "twp" });
/** Characters only, with the phrase tables that pick the right form
 *  of an ambiguous character (日历→日曆, 公里 stays 公里), but no
 *  vocabulary substitution. */
const toTaiwanCharacters = OpenCC.Converter({ from: "cn", to: "tw" });

/**
 * Where OpenCC's Taiwan phrasing picks the wrong sense for this app.
 * Applied after conversion, longest first. Keep this short: each entry
 * is a word that means something specific here.
 */
const OVERRIDES: Array<[string, string]> = [
  // 窗口 as a span of time ("the 24-hour window"), not a UI window.
  ["小時視窗", "小時時段"],
  ["上報視窗", "上報時段"],
  ["視窗已", "時段已"],
  ["視窗內", "時段內"],
  // 在线预订 is "book online", not a product called 線上預定.
  ["線上預定", "線上預訂"],
  // 审核通过 is "approved": OpenCC reads 通过 as "by way of" (透過)
  // and 审核 as an auditor's 稽覈.
  ["稽覈透過", "審核通過"],
  ["透過稽覈", "通過審核"],
  ["沒透過", "沒通過"],
  ["稽覈", "審核"],
  // 帳 is the Taiwan standard (帳戶, 帳號, 帳單) and what the operator's
  // own Traditional site uses; OpenCC keeps the mainland-leaning 賬.
  ["賬", "帳"],
  // 臺 is the formal form; 台 is what Taiwan and Hong Kong actually
  // write for a car (一台車) and a platform (平台).
  ["臺", "台"],
];

function applyOverrides(text: string) {
  let out = text;
  for (const [from, to] of [...OVERRIDES].sort((a, b) => b[0].length - a[0].length)) {
    out = out.split(from).join(to);
  }
  return out;
}

/**
 * For the UI's own strings, whose every conversion is reviewed in the
 * generated files' diff: full Taiwan phrasing.
 */
export function convertUiToTraditional(text: string) {
  return applyOverrides(toTaiwanPhrasing(text));
}

/**
 * For an operator's own words, which nobody reviews after conversion:
 * characters only. Vocabulary substitution segments text it has never
 * seen, and gets it wrong -- "列治文本地团队" (a Richmond local team)
 * was read as 列治 + 文本 ("text") + 地 and came out 列治文字地團隊.
 * A mainland word left in Traditional characters reads fine; a word
 * that was never there does not.
 */
export function convertContentToTraditional(text: string) {
  return applyOverrides(toTaiwanCharacters(text));
}
