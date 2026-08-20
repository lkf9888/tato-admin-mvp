#!/usr/bin/env node
/**
 * Turo browser agent.
 *
 * Reads conversations off the Turo website using a session you logged
 * into by hand, and pushes them to TATO. See README.md for why this
 * cannot be a server job and cannot be an API call.
 */

import { chromium } from "playwright";
import { mkdir, access } from "fs/promises";
import path from "path";
import readline from "readline";

const STATE_DIR = path.join(process.cwd(), "agent", ".state");
const STATE_FILE = path.join(STATE_DIR, "turo.json");

const TATO_URL = (process.env.TATO_URL ?? "https://tatocar.co").replace(/\/+$/, "");
const TOKEN = process.env.TATO_AGENT_TOKEN ?? "";

const args = new Set(process.argv.slice(2));
const LIMIT = Number.parseInt(
  process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? "20",
  10,
);

/** Human pace. Turo is not a load test, and a script that reads faster
 *  than a person is a script that gets noticed. */
const PAUSE_MS = 1500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

async function stateExists() {
  try {
    await access(STATE_FILE);
    return true;
  } catch {
    return false;
  }
}

async function login() {
  await mkdir(STATE_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("https://turo.com/us/en/login");

  console.log("\nLog into Turo in the window that opened, including any 2FA.");
  console.log("When you can see your host dashboard, press Enter here.\n");

  await new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question("", () => {
      rl.close();
      resolve();
    });
  });

  await context.storageState({ path: STATE_FILE });
  await browser.close();
  console.log(`\n✔ Session saved to ${STATE_FILE}`);
  console.log("  This file is a live login. It is gitignored. Treat it like a password.\n");
}

async function push(reservationId, messages) {
  const response = await fetch(`${TATO_URL}/api/agent/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ reservationId, messages, source: "turo-agent" }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`TATO rejected ${reservationId}: ${response.status} ${JSON.stringify(body)}`);
  }
  return body;
}

/**
 * Read one conversation.
 *
 * Selectors are the fragile part. They are asserted rather than
 * defaulted: a thread that genuinely has no messages and a thread whose
 * markup moved look identical in the output, and returning an empty
 * list for the second would quietly delete nothing and report success.
 */
async function readConversation(page, reservationId) {
  await page.goto(`https://turo.com/us/en/reservation/${reservationId}/messages`, {
    waitUntil: "domcontentloaded",
  });
  await sleep(PAUSE_MS);

  const container = page.locator('[data-testid*="message"], [class*="message"]').first();
  if ((await container.count()) === 0) {
    throw new Error(
      `No message container on reservation ${reservationId}. Turo's markup has probably moved -- ` +
        `open the page with --headed and update the selectors in readConversation().`,
    );
  }

  return page.evaluate(() => {
    // Turo renders each message as a block carrying the text and a
    // timestamp. Direction is read from which side the bubble sits on
    // rather than from a class name, because the classes are hashed at
    // build time and the layout is not.
    const nodes = [...document.querySelectorAll('[class*="message"], [data-testid*="message"]')];
    const out = [];
    const seen = new Set();

    for (const node of nodes) {
      const text = (node.innerText || "").trim();
      if (!text || text.length < 2 || seen.has(text)) continue;

      const time = node.querySelector("time");
      const sentAt = time?.getAttribute("datetime") ?? null;
      if (!sentAt) continue;

      const rect = node.getBoundingClientRect();
      const parentRect = node.parentElement?.getBoundingClientRect();
      const outbound =
        parentRect != null &&
        rect.right >= parentRect.right - 4 &&
        rect.left > parentRect.left + parentRect.width * 0.25;

      seen.add(text);
      out.push({
        direction: outbound ? "outbound" : "inbound",
        body: text.slice(0, 4000),
        sentAt: new Date(sentAt).toISOString(),
      });
    }

    return out;
  });
}

async function run() {
  if (!TOKEN) fail("Set TATO_AGENT_TOKEN. Mint one in TATO under agent tokens.");
  if (!(await stateExists())) fail("No saved session. Run with --login first.");

  const browser = await chromium.launch({ headless: !args.has("--headed") });
  const context = await browser.newContext({ storageState: STATE_FILE });
  const page = await context.newPage();

  // Reservations to read, newest first, straight from TATO -- it
  // already knows every reservation the mailbox has seen, so the agent
  // does not have to crawl a list page to find them.
  const listed = await fetch(`${TATO_URL}/api/agent/reservations?limit=${LIMIT}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (!listed.ok) fail(`Could not list reservations: ${listed.status}`);
  const { reservationIds } = await listed.json();

  console.log(`Reading ${reservationIds.length} conversations...\n`);

  let created = 0;
  let updated = 0;
  const failures = [];

  for (const reservationId of reservationIds) {
    try {
      const messages = await readConversation(page, reservationId);
      if (messages.length === 0) {
        console.log(`  ${reservationId}: no messages`);
        continue;
      }
      const result = await push(reservationId, messages);
      created += result.created;
      updated += result.updated;
      console.log(
        `  ${reservationId}: ${messages.length} read, ${result.created} new, ${result.updated} changed`,
      );
    } catch (error) {
      failures.push(`${reservationId}: ${error.message}`);
      console.error(`  ${reservationId}: ${error.message}`);
    }
    await sleep(PAUSE_MS);
  }

  await browser.close();

  console.log(`\n✔ ${created} new, ${updated} updated`);
  if (failures.length > 0) {
    console.error(`\n✖ ${failures.length} conversation(s) failed:`);
    for (const failure of failures) console.error(`   ${failure}`);
    // Non-zero so a scheduled run is visibly broken rather than
    // quietly reading nothing.
    process.exit(1);
  }
}

if (args.has("--login")) {
  await login();
} else if (args.has("--conversations")) {
  await run();
} else {
  console.log(`
Turo browser agent

  node agent/turo-agent.mjs --login              log in by hand, once
  node agent/turo-agent.mjs --conversations      read and push conversations
      --limit=N     how many reservations (default 20)
      --headed      show the browser

Environment:
  TATO_URL           default https://tatocar.co
  TATO_AGENT_TOKEN   required; mint one in TATO
`);
}
