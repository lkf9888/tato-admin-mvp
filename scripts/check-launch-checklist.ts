/**
 * Keep the two copies of the launch checklist in step.
 *
 * The checklist exists twice on purpose: `docs/wechat-mini-program-launch.md`
 * is the repo-native copy that reviews and greps, and
 * `docs/wechat-mini-program-launch.html` is the source of the Artifact
 * page someone actually ticks through on the day. Neither is generated
 * from the other, because the two formats genuinely want different
 * shapes -- the subject comparison is a table in Markdown and a pair of
 * cards on the page, and forcing them identical would make one of them
 * worse.
 *
 * So this checks the part that must never differ: the same steps, in the
 * same order, under the same phases, with the same errcode table. Prose
 * inside a step is each format's own business. Adding a step to one copy
 * and forgetting the other is the drift that actually happens, and it is
 * what this catches.
 *
 * Steps are paired by id: `data-id` in the HTML, and a trailing
 * `<!-- id:... -->` comment on the Markdown item, which no Markdown
 * renderer shows. That pairing is why wording may differ without the
 * check going blind.
 *
 * What this CANNOT check: whether the PUBLISHED artifact matches the
 * HTML in this repo. It lives behind claude.ai auth with no fetchable
 * URL, so republishing from `docs/wechat-mini-program-launch.html` after
 * changing it is a human step.
 */

import { readFileSync } from "fs";
import { join } from "path";

const ROOT = join(import.meta.dirname ?? __dirname, "..");
const MD_PATH = "docs/wechat-mini-program-launch.md";
const HTML_PATH = "docs/wechat-mini-program-launch.html";

type Problem = { where: string; detail: string };

const problems: Problem[] = [];

function fail(where: string, detail: string) {
  problems.push({ where, detail });
}

function read(relative: string) {
  try {
    return readFileSync(join(ROOT, relative), "utf8");
  } catch {
    fail(relative, "文件不存在");
    return "";
  }
}

const md = read(MD_PATH);
const html = read(HTML_PATH);
if (!md || !html) {
  report();
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* steps                                                               */
/* ------------------------------------------------------------------ */

const htmlStepIds = [...html.matchAll(/class="step" data-id="([^"]+)"/g)].map((m) => m[1]);
const mdStepIds = [...md.matchAll(/^- \[[ x]\][^\n]*?<!--\s*id:([^\s]+)\s*-->/gm)].map((m) => m[1]);

// An untagged Markdown item would silently drop out of the comparison,
// which is the one way this check could pass while being wrong.
const mdItemCount = (md.match(/^- \[[ x]\]/gm) ?? []).length;
if (mdItemCount !== mdStepIds.length) {
  fail(
    MD_PATH,
    `${mdItemCount} 个勾选项，但只有 ${mdStepIds.length} 个带 <!-- id:... --> 标记。` +
      `每一项都要有，否则对不上 HTML。`,
  );
}

for (const [label, ids] of [
  [HTML_PATH, htmlStepIds],
  [MD_PATH, mdStepIds],
] as const) {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) fail(label, `步骤 id 重复：${id}`);
    seen.add(id);
  }
}

const htmlSet = new Set(htmlStepIds);
const mdSet = new Set(mdStepIds);
const onlyHtml = htmlStepIds.filter((id) => !mdSet.has(id));
const onlyMd = mdStepIds.filter((id) => !htmlSet.has(id));

if (onlyHtml.length) fail(MD_PATH, `缺少这些步骤（HTML 里有）：${onlyHtml.join(", ")}`);
if (onlyMd.length) fail(HTML_PATH, `缺少这些步骤（Markdown 里有）：${onlyMd.join(", ")}`);

if (!onlyHtml.length && !onlyMd.length && htmlStepIds.join(",") !== mdStepIds.join(",")) {
  fail(
    "两份文档",
    `步骤顺序不一致。\n      HTML: ${htmlStepIds.join(" ")}\n      MD:   ${mdStepIds.join(" ")}`,
  );
}

/* ------------------------------------------------------------------ */
/* phases                                                              */
/* ------------------------------------------------------------------ */

// HTML numbers phases "00".."06"; the troubleshooting section is marked
// with a glyph instead and is compared through its table below.
const htmlPhases = [...html.matchAll(/<span class="phase-num">(\d+)<\/span>\s*<h2>([^<]+)<\/h2>/g)].map(
  (m) => ({ num: String(Number(m[1])), title: m[2].trim() }),
);
const mdPhases = [...md.matchAll(/^## (\d+) · (.+)$/gm)].map((m) => ({
  num: m[1],
  title: m[2].trim(),
}));

if (htmlPhases.length !== mdPhases.length) {
  fail("两份文档", `阶段数量不一致：HTML ${htmlPhases.length} 个，Markdown ${mdPhases.length} 个`);
} else {
  htmlPhases.forEach((phase, index) => {
    const other = mdPhases[index];
    if (phase.num !== other.num || phase.title !== other.title) {
      fail(
        "两份文档",
        `第 ${index + 1} 个阶段对不上：HTML「${phase.num} ${phase.title}」/ ` +
          `Markdown「${other.num} ${other.title}」`,
      );
    }
  });
}

/* ------------------------------------------------------------------ */
/* errcode table                                                       */
/* ------------------------------------------------------------------ */

const htmlTable = html.slice(html.indexOf("<tbody>"), html.indexOf("</tbody>"));
const htmlCodes = [...htmlTable.matchAll(/<tr>\s*<td>(?:<code>)?([^<]+)(?:<\/code>)?<\/td>/g)].map((m) =>
  m[1].trim(),
);
// Scoped to the troubleshooting section: the subject comparison earlier
// in the document is a table too, and its rows are not errcodes.
const ERRCODE_HEADING = "## 收不到消息时对照";
const mdErrcodeSection = md.slice(md.indexOf(ERRCODE_HEADING));
if (!md.includes(ERRCODE_HEADING)) {
  fail(MD_PATH, `找不到「${ERRCODE_HEADING}」一节`);
}
const mdCodes = [...mdErrcodeSection.matchAll(/^\| (?:`([^`]+)`|(—)) \|/gm)].map((m) =>
  (m[1] ?? m[2]).trim(),
);

if (htmlCodes.join(",") !== mdCodes.join(",")) {
  fail(
    "两份文档",
    `errcode 对照表不一致。\n      HTML: ${htmlCodes.join(" ")}\n      MD:   ${mdCodes.join(" ")}`,
  );
}

/* ------------------------------------------------------------------ */

function report() {
  if (problems.length === 0) {
    console.log(
      `上线清单两份一致：${htmlStepIds.length} 个步骤、${htmlPhases.length} 个阶段、` +
        `${htmlCodes.length} 行 errcode。`,
    );
    return;
  }

  console.error("上线清单的两份内容对不上：\n");
  for (const problem of problems) {
    console.error(`  ${problem.where}`);
    console.error(`      ${problem.detail}\n`);
  }
  console.error(
    `改完记得两份都改：\n` +
      `  ${MD_PATH}\n` +
      `  ${HTML_PATH}\n\n` +
      `新增步骤要在 Markdown 那一项末尾加 <!-- id:xxx -->，和 HTML 的 data-id 对上。\n` +
      `改完 HTML 之后还要重新发布 Artifact —— 那一步 CI 检查不到。`,
  );
}

report();
process.exit(problems.length === 0 ? 0 : 1);
