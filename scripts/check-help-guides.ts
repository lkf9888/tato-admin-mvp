/**
 * The help manual keeps up with the sidebar and with its own pictures.
 *
 * - Every sidebar page has a guide in both languages, and no guide points
 *   at a page that is gone.
 * - The two languages have the same sections, pictures and step counts,
 *   since a picture's numbered marks point at steps by number.
 * - Every picture a section names is in the shot list, was taken in both
 *   languages, and has no mark beyond the section's last step.
 *
 * A page added without its guide would simply be missing from the
 * manual, which nobody notices until a user asks.
 *
 * Run: npx tsx scripts/check-help-guides.ts
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { guides as enGuides } from "../app/(admin)/help/guides/en";
import { guides as zhGuides } from "../app/(admin)/help/guides/zh";
import { SHOTS, type ShotMarks } from "../app/(admin)/help/shots";

const root = process.cwd();
const shell = readFileSync(path.join(root, "components/app-shell.tsx"), "utf8");
const navKeys = [...shell.matchAll(/\{ href: "\/([a-z-]+)", label: messages\.shell\.nav\./g)]
  .map((match) => match[1])
  .filter((key) => key !== "help");
const marks = JSON.parse(
  readFileSync(path.join(root, "app/(admin)/help/shots/marks.json"), "utf8"),
) as Record<string, Partial<Record<"zh" | "en", ShotMarks>>>;
const shotIds = new Set(SHOTS.map((shot) => shot.id));

const problems: string[] = [];
for (const [name, guides] of [["zh", zhGuides], ["en", enGuides]] as const) {
  const keys = guides.map((guide) => guide.key);
  for (const key of navKeys) if (!keys.includes(key)) problems.push(`${name}: no guide for /${key}`);
  for (const key of keys) if (!navKeys.includes(key)) problems.push(`${name}: guide for /${key}, which is not in the sidebar`);
  for (const guide of guides) {
    for (const section of guide.sections) {
      if (!section.shot) continue;
      const where = `${name} ${guide.key} "${section.heading}"`;
      if (!shotIds.has(section.shot)) problems.push(`${where}: shot ${section.shot} is not in app/(admin)/help/shots`);
      if (!existsSync(path.join(root, "public/help/shots", name, `${section.shot}.jpg`))) {
        problems.push(`${where}: picture public/help/shots/${name}/${section.shot}.jpg was never taken`);
      }
      const taken = marks[section.shot]?.[name];
      if (!taken) problems.push(`${where}: no marks for ${section.shot} in marks.json`);
      for (const mark of taken?.marks ?? []) {
        if (mark.step > section.steps.length) problems.push(`${where}: mark ${mark.step} has no step`);
      }
    }
  }
}

zhGuides.forEach((zh, index) => {
  const en = enGuides[index];
  if (!en || en.key !== zh.key) {
    problems.push(`zh and en list the guides in a different order at ${zh.key}`);
    return;
  }
  if (zh.sections.length !== en.sections.length) problems.push(`${zh.key}: zh has ${zh.sections.length} sections, en ${en.sections.length}`);
  zh.sections.forEach((section, i) => {
    const other = en.sections[i];
    if (!other) return;
    if (section.shot !== other.shot) problems.push(`${zh.key} section ${i + 1}: zh shows ${section.shot}, en ${other.shot}`);
    if (section.steps.length !== other.steps.length) {
      problems.push(`${zh.key} "${section.heading}": zh has ${section.steps.length} steps, en ${other.steps.length}`);
    }
  });
});

if (problems.length > 0) {
  console.error(`Help manual is out of step:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
const pictures = zhGuides.reduce((sum, guide) => sum + guide.sections.filter((section) => section.shot).length, 0);
console.log(`Help manual covers all ${navKeys.length} sidebar pages in both languages, with ${pictures} marked pictures.`);
