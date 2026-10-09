/**
 * The help manual keeps up with the sidebar.
 *
 * Every page in the sidebar needs a guide in both languages and a
 * screenshot in both sets, and nothing in the manual may point at a page
 * that no longer exists. A page added without its guide would simply be
 * missing from the manual, which nobody notices until a user asks.
 *
 * Run: npx tsx scripts/check-help-guides.ts
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { guides as enGuides } from "../app/(admin)/help/guides/en";
import { guides as zhGuides } from "../app/(admin)/help/guides/zh";

const root = process.cwd();
const shell = readFileSync(path.join(root, "components/app-shell.tsx"), "utf8");
const navKeys = [...shell.matchAll(/\{ href: "\/([a-z-]+)", label: messages\.shell\.nav\./g)]
  .map((match) => match[1])
  .filter((key) => key !== "help");

const problems: string[] = [];
for (const [name, guides] of [["zh", zhGuides], ["en", enGuides]] as const) {
  const keys = guides.map((guide) => guide.key);
  for (const key of navKeys) if (!keys.includes(key)) problems.push(`${name}: no guide for /${key}`);
  for (const key of keys) if (!navKeys.includes(key)) problems.push(`${name}: guide for /${key}, which is not in the sidebar`);
  for (const key of keys) {
    const shot = path.join(root, "public/help/pages", name, `${key}.jpg`);
    if (!existsSync(shot)) problems.push(`${name}: no screenshot ${path.relative(root, shot)}`);
  }
}
if (zhGuides.map((g) => g.key).join() !== enGuides.map((g) => g.key).join()) {
  problems.push("zh and en list the guides in a different order");
}

if (problems.length > 0) {
  console.error(`Help manual is out of step with the sidebar:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log(`Help manual covers all ${navKeys.length} sidebar pages in both languages.`);
