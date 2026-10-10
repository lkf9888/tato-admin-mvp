/**
 * Shoots the help manual's screenshots and works out where their
 * numbered marks go.
 *
 * Every shot is listed in app/(admin)/help/shots/: the page to open, what
 * to click first (a menu, a dialog, some picked days), and the elements to
 * mark. This script opens each one in both languages, takes the picture
 * (public/help/shots/<zh|en>/<id>.jpg) and measures each marked element,
 * writing the boxes, as shares of the picture, to
 * app/(admin)/help/shots/marks.json. The manual draws them over the
 * picture, so a retake after a redesign moves the marks with the buttons.
 *
 * It shoots the local dev server signed in as the bypass admin from
 * .env.local -- never production, whose pages show renters' names and
 * phones -- so seed the local database with demo data first. Notices
 * only a server without production keys shows are hidden.
 *
 * Needs Playwright, which this repo does not install:
 *   PLAYWRIGHT=/path/to/node_modules/playwright npx tsx scripts/capture-help-screenshots.ts
 * Options: BASE (default http://localhost:3000), SHOTS=calendar-order,…
 * (only these), LOCALES=zh,en.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { SHOTS, type Action, type Label, type ShotMarks, type Target } from "../app/(admin)/help/shots";

type Locale = "zh" | "en";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Page = any;

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT || "playwright");

const ROOT = process.cwd();
const BASE = process.env.BASE || "http://localhost:3000";
const MARKS_FILE = path.join(ROOT, "app/(admin)/help/shots/marks.json");
const VIEWPORT = { width: 1440, height: 900 };
const LOCALES = (process.env.LOCALES || "zh,en").split(",") as Locale[];
const ONLY = process.env.SHOTS ? new Set(process.env.SHOTS.split(",")) : null;

const DEV_ONLY_NOTICES = [
  "KIMI_API_KEY",
  "GMAIL_IMAP",
  "STRIPE_SECRET_KEY",
  "Stripe 计费尚未配置",
  "Stripe billing is not configured",
  "调试免额度",
  "debug quota",
  "服务器尚未配置 Stripe",
  "not configured on this server",
  "sample-data/turo-sample.csv",
];

const env = Object.fromEntries(
  readFileSync(path.join(ROOT, ".env.local"), "utf8")
    .split("\n")
    .map((line) => line.match(/^([A-Z_]+)="?(.*?)"?$/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => [match[1], match[2]]),
);

const text = (label: Label | undefined, locale: Locale) =>
  label === undefined ? "" : typeof label === "string" ? label : label[locale];
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function locate(page: Page, target: Target, locale: Locale) {
  let locator;
  if (target.css) locator = page.locator(target.css);
  else if (target.role) {
    const name = text(target.name, locale);
    locator = page.getByRole(target.role, {
      name: target.exact ? name : new RegExp(escape(name)),
      exact: target.exact,
    });
  } else if (target.placeholder) locator = page.getByPlaceholder(text(target.placeholder, locale));
  else locator = page.getByText(text(target.text, locale), { exact: target.exact ?? false });
  const visible = locator.locator("visible=true");
  return target.last ? visible.last() : visible.nth(target.nth ?? 0);
}

async function box(page: Page, target: Target, locale: Locale) {
  const locator = locate(page, target, locale);
  try {
    await locator.waitFor({ state: "visible", timeout: 4000 });
    return await locator.boundingBox();
  } catch {
    return null;
  }
}

async function run(page: Page, action: Action, locale: Locale) {
  if ("click" in action) await locate(page, action.click, locale).click({ timeout: 8000 });
  else if ("fill" in action) await locate(page, action.fill, locale).fill(action.value);
  else if ("check" in action) await locate(page, action.check, locale).check();
  else if ("press" in action) await page.keyboard.press(action.press);
  else if ("wait" in action) await page.waitForTimeout(action.wait);
  else if ("scrollTo" in action) {
    await locate(page, action.scrollTo, locale).evaluate((element: Element) => {
      element.scrollIntoView({ block: "start" });
      window.scrollBy(0, -16);
    });
    await page.waitForTimeout(300);
  } else if ("pickDays" in action) {
    // A day cell is a click on the empty row at that day's column.
    // Today's column is the one element positioned by day there.
    const points = await page.evaluate(({ plate, days }: { plate: string; days: number[] }) => {
      const rows = [...document.querySelectorAll<HTMLElement>(".group\\/row")];
      const row = rows.find((item) => item.firstElementChild?.textContent?.trim().startsWith(plate));
      const lane = row?.children[1] as HTMLElement | undefined;
      const today = lane?.querySelector<HTMLElement>("div.bg-\\[rgba\\(89\\,60\\,251\\,0\\.08\\)\\]");
      if (!lane || !today) return [];
      const column = today.getBoundingClientRect();
      const laneBox = lane.getBoundingClientRect();
      return days.map((offset) => ({
        x: column.left + offset * column.width + column.width / 2,
        y: laneBox.top + laneBox.height / 2,
      }));
    }, action.pickDays);
    for (const point of points) {
      await page.mouse.click(point.x, point.y);
      await page.waitForTimeout(250);
    }
  }
}

/** Where the picture is cut from, in viewport pixels. */
async function clipFor(page: Page, shot: (typeof SHOTS)[number], locale: Locale) {
  const viewport = { width: VIEWPORT.width, height: shot.viewportHeight ?? VIEWPORT.height };
  const sidebar = await page.evaluate(() => {
    const aside = document.querySelector("aside");
    const rect = aside?.getBoundingClientRect();
    return rect && rect.left < 5 && rect.width < 400 ? Math.ceil(rect.right) : 0;
  });
  const whole = { x: sidebar, y: 0, width: viewport.width - sidebar, height: viewport.height };
  if (!shot.clip) {
    // Trimmed to what the page draws: a narrow page left most of the
    // picture blank, which only shrank the part worth reading.
    const used = await page.evaluate(
      ({ left, height }: { left: number; height: number }) => {
        let right = left;
        let bottom = 0;
        for (const element of document.querySelectorAll("main *")) {
          const rect = element.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0 || rect.left < left) continue;
          if (rect.top >= height || rect.bottom <= 0) continue;
          const style = getComputedStyle(element);
          if (style.visibility === "hidden" || style.position === "fixed") continue;
          right = Math.max(right, Math.min(rect.right, window.innerWidth));
          bottom = Math.max(bottom, Math.min(rect.bottom, height));
        }
        return { right, bottom };
      },
      { left: sidebar, height: viewport.height },
    );
    return {
      ...whole,
      width: Math.min(whole.width, Math.max(480, Math.ceil(used.right - sidebar + 16))),
      height: Math.min(whole.height, Math.max(320, Math.ceil(used.bottom + 16))),
    };
  }
  const pad = shot.clip.pad ?? 12;
  let rect: { x: number; y: number; width: number; height: number } | null = null;
  if ("dialog" in shot.clip) {
    rect = await page.evaluate(() => {
      const dialogs = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].filter(
        (element) => element.getBoundingClientRect().width > 0,
      );
      let panel = dialogs[dialogs.length - 1];
      if (!panel) return null;
      // A backdrop covering the screen: the panel is the child on it.
      const outer = panel.getBoundingClientRect();
      if (outer.width >= window.innerWidth - 2 && panel.firstElementChild) {
        panel = panel.firstElementChild as HTMLElement;
      }
      const r = panel.getBoundingClientRect();
      return { x: r.left, y: r.top, width: r.width, height: r.height };
    });
  } else {
    rect = await box(page, shot.clip.element, locale);
  }
  if (!rect) return whole;
  const x = Math.max(0, rect.x - pad);
  const y = Math.max(0, rect.y - pad);
  return {
    x,
    y,
    width: Math.min(viewport.width - x, rect.width + pad * 2),
    height: Math.min(viewport.height - y, rect.height + pad * 2),
  };
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const page: Page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', env.BILLING_BYPASS_ADMIN_EMAIL);
  await page.fill('input[name="password"]', env.BILLING_BYPASS_ADMIN_PASSWORD);
  await Promise.all([
    page.waitForURL((url: URL) => !url.pathname.startsWith("/login"), { timeout: 60000 }),
    page.press('input[name="password"]', "Enter"),
  ]);

  const marksFile: Record<string, Partial<Record<Locale, ShotMarks>>> = existsSync(MARKS_FILE)
    ? JSON.parse(readFileSync(MARKS_FILE, "utf8"))
    : {};
  let problems = 0;

  for (const locale of LOCALES) {
    await context.addCookies([{ name: "turo-locale", value: locale, url: BASE }]);
    mkdirSync(path.join(ROOT, "public/help/shots", locale), { recursive: true });
    for (const shot of SHOTS) {
      if (ONLY && !ONLY.has(shot.id)) continue;
      try {
        await page.setViewportSize({ width: VIEWPORT.width, height: shot.viewportHeight ?? VIEWPORT.height });
        await page.goto(`${BASE}${shot.path}`, { waitUntil: "load", timeout: 120000 });
        await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
        if (shot.path.startsWith("/calendar")) {
          await page.waitForSelector("[data-calendar-order-bar]", { timeout: 60000 }).catch(() => {});
        }
        await page.addStyleTag({
          content: "nextjs-portal{display:none!important} *{transition:none!important;animation:none!important;caret-color:transparent!important}",
        });
        await page.evaluate((patterns: string[]) => {
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          const hits: Element[] = [];
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            if (patterns.some((pattern) => node!.textContent?.includes(pattern)) && node.parentElement) {
              hits.push(node.parentElement);
            }
          }
          for (const element of hits) if (element !== document.body) (element as HTMLElement).style.display = "none";
        }, DEV_ONLY_NOTICES);
        await page.waitForTimeout(1200);
        for (const action of shot.setup ?? []) await run(page, action, locale);
        await page.waitForTimeout(500);

        const clip = await clipFor(page, shot, locale);
        const marks: ShotMarks["marks"] = [];
        for (const mark of shot.marks) {
          const found = await box(page, mark.target, locale);
          const inside =
            found &&
            found.x + found.width > clip.x &&
            found.x < clip.x + clip.width &&
            found.y + found.height > clip.y &&
            found.y < clip.y + clip.height;
          if (!found || !inside) {
            problems += 1;
            console.log(`  ! ${locale} ${shot.id} step ${mark.step}: ${found ? "outside the picture" : "not found"} ${JSON.stringify(mark.target)}`);
            continue;
          }
          const left = Math.max(found.x, clip.x);
          const top = Math.max(found.y, clip.y);
          const right = Math.min(found.x + found.width, clip.x + clip.width);
          const bottom = Math.min(found.y + found.height, clip.y + clip.height);
          const round = (value: number) => Math.round(value * 1000) / 10;
          marks.push({
            step: mark.step,
            x: round((left - clip.x) / clip.width),
            y: round((top - clip.y) / clip.height),
            w: round((right - left) / clip.width),
            h: round((bottom - top) / clip.height),
          });
        }
        await page.screenshot({
          path: path.join(ROOT, "public/help/shots", locale, `${shot.id}.jpg`),
          type: "jpeg",
          quality: 74,
          clip,
        });
        marksFile[shot.id] = {
          ...marksFile[shot.id],
          [locale]: { width: Math.round(clip.width), height: Math.round(clip.height), marks },
        };
        console.log(`${locale} ${shot.id} ok (${marks.length}/${shot.marks.length} marks)`);
      } catch (error) {
        problems += 1;
        console.log(`  ! ${locale} ${shot.id} FAILED ${(error as Error).message.split("\n")[0]}`);
      }
      await page.keyboard.press("Escape").catch(() => {});
    }
  }

  const ordered = Object.fromEntries(
    SHOTS.filter((shot) => marksFile[shot.id]).map((shot) => [shot.id, marksFile[shot.id]]),
  );
  // One line per shot and language, so a retake diffs as the shots it moved.
  const lines = Object.entries(ordered).map(
    ([id, byLocale]) =>
      `  ${JSON.stringify(id)}: {\n${Object.entries(byLocale ?? {})
        .map(([locale, value]) => `    ${JSON.stringify(locale)}: ${JSON.stringify(value)}`)
        .join(",\n")}\n  }`,
  );
  writeFileSync(MARKS_FILE, `{\n${lines.join(",\n")}\n}\n`);
  await browser.close();
  console.log(problems ? `${problems} problem(s); see "!" lines above.` : "All shots and marks found.");
}

void main();
