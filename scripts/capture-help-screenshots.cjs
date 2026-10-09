/**
 * Retakes the help manual's screenshots: public/help/pages/<zh|en>/<page>.jpg.
 *
 * Shoots the local dev server signed in as the bypass admin from
 * .env.local -- never production, whose pages show real renters' names
 * and phones. Seed the local database with demo data first. Notices only
 * a server without production keys shows (no Stripe, no AI key) are
 * hidden, and the sidebar is cropped off: the manual lists the pages
 * itself. Page text is written beside the shots, to quote button labels
 * from when writing a guide.
 *
 * Needs Playwright, which this repo does not install:
 *   PLAYWRIGHT=/path/to/node_modules/playwright node scripts/capture-help-screenshots.cjs
 * Options: BASE (default http://localhost:3000), PAGES=calendar,orders,
 * LOCALES=zh,en, TEXT_DIR (default: a temp folder), RESCAN=0 to keep the
 * assistant alerts as they are rather than rescanning first.
 */
const { chromium } = require(process.env.PLAYWRIGHT || "playwright");
const fs = require("fs");
const path = require("path");

const REPO = path.join(__dirname, "..");
const OUT_SHOTS = path.join(REPO, "public/help/pages");
const OUT_TEXT = process.env.TEXT_DIR || path.join(require("os").tmpdir(), "tato-help-text");
const BASE = process.env.BASE || "http://localhost:3000";
const env = Object.fromEntries(
  fs.readFileSync(path.join(REPO, ".env.local"), "utf8").split("\n")
    .map((l) => l.match(/^([A-Z_]+)="?(.*?)"?$/)).filter(Boolean).map((m) => [m[1], m[2]]),
);
const PAGES = (process.env.PAGES || "dashboard,assistant,messages,updates,calendar,orders,imports,vehicles,vehicle-roi,owners,direct-booking,staff-schedule,contracts,inspections,photos,documents,activity,trash,billing,payouts,invoices,account-settings").split(",");
const LOCALES = (process.env.LOCALES || "zh,en").split(",");

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', env.BILLING_BYPASS_ADMIN_EMAIL);
  await page.fill('input[name="password"]', env.BILLING_BYPASS_ADMIN_PASSWORD);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60000 }), page.press('input[name="password"]', 'Enter')]);
  for (const locale of LOCALES) {
    await context.addCookies([{ name: "turo-locale", value: locale, url: BASE }]);
    fs.mkdirSync(path.join(OUT_SHOTS, locale), { recursive: true });
    fs.mkdirSync(path.join(OUT_TEXT, locale), { recursive: true });
    for (const key of PAGES) {
      const started = Date.now();
      try {
        await page.goto(`${BASE}/${key}`, { waitUntil: "load", timeout: 120000 });
        await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
        if (key === "calendar") await page.waitForSelector("[data-calendar-order-bar]", { timeout: 60000 }).catch(() => {});
        // Alerts are written by a scan; rescan so they are in this language.
        if (key === "assistant" && process.env.RESCAN !== "0") {
          await page.getByRole("button", { name: /Rescan|重新扫描/ }).click().catch(() => {});
          await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
        }
        await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
        // Notices only a server without production keys shows; a real
        // account never sees them, so they stay out of the manual.
        await page.evaluate((patterns) => {
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          const hits = [];
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            if (patterns.some((pattern) => node.textContent.includes(pattern))) hits.push(node);
          }
          for (const node of hits) {
            // The element that holds the sentence itself, not its
            // container -- a container can hold the input beside it.
            const block = node.parentElement;
            if (block && block !== document.body) block.style.display = "none";
          }
        }, ["KIMI_API_KEY", "GMAIL_IMAP", "STRIPE_SECRET_KEY", "Stripe 计费尚未配置", "Stripe billing is not configured", "Stripe billing isn't configured", "调试免额度", "debug quota", "服务器尚未配置 Stripe", "not configured on this server", "sample-data/turo-sample.csv"]);
        await page.waitForTimeout(2500);
        // The page, not the sidebar: the manual has its own list of
        // pages beside the picture, and the sidebar only shrank the page.
        const sidebar = await page.evaluate(() => {
          const aside = document.querySelector("aside");
          const box = aside?.getBoundingClientRect();
          return box && box.left < 5 && box.width < 400 ? Math.ceil(box.right) : 0;
        });
        await page.screenshot({
          path: path.join(OUT_SHOTS, locale, `${key}.jpg`),
          type: "jpeg",
          quality: 80,
          clip: { x: sidebar, y: 0, width: 1440 - sidebar, height: 900 },
        });
        const text = await page.evaluate(() => (document.querySelector("main") || document.body).innerText);
        fs.writeFileSync(path.join(OUT_TEXT, locale, `${key}.txt`), `URL: ${page.url()}\n\n` + text);
        console.log(locale, key, "ok", Date.now() - started, "ms", page.url());
      } catch (error) {
        console.log(locale, key, "FAILED", error.message.split("\n")[0]);
      }
    }
  }
  await browser.close();
})();
