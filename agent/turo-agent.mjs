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
 * The selectors below were derived from the live page, not guessed.
 * What the DOM actually looks like:
 *
 *   div[class*="conversationInnerContainerStyles"]   the thread
 *     div[class*="messageOuterContainerStyles"]      one bubble
 *       ...
 *       p  "10:27 PM - Amarpreet (Guest)"            attribution
 *
 * Two things that shaped the approach:
 *
 * A message can be several bubbles with one attribution line at the
 * end -- 41 bubbles carried 26 messages on the thread this was written
 * against -- so bubbles are not messages. The attribution line is what
 * terminates one, and the text since the previous attribution is its
 * body. That is also how a person reads it.
 *
 * Direction comes from the role in that line, `(Guest)` against
 * `(Co-host)`, not from which side the bubble sits on. Bubble position
 * is a layout decision and layouts get rewritten; the role is content.
 *
 * Class names are emotion hashes, but each carries a readable suffix
 * (`conversationInnerContainerStyles`). Matching the suffix survives a
 * rebuild; matching the hash would not.
 */
async function readConversation(page, reservationId) {
  await page.goto(`https://turo.com/us/en/reservation/${reservationId}/messages`, {
    waitUntil: "domcontentloaded",
  });
  await sleep(PAUSE_MS);

  const result = await page.evaluate(() => {
    const ATTRIBUTION =
      /^(\d{1,2}:\d{2}\s*(?:AM|PM))\s*[-\u2013]\s*(.+?)\s*\((Guest|Co-host|Host|Owner)\)\s*$/i;
    // Conversation separators carry the year. The trip header shows
    // dates without one, and treating those as separators put every
    // message on the wrong day.
    const DAY = /^(Today|Yesterday|[A-Z][a-z]{2},\s+[A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})$/;

    const bubbles = [...document.querySelectorAll('div[class*="messageOuterContainerStyles"]')];
    if (bubbles.length === 0) return { error: "no-bubbles" };

    // Scope to the thread. Walking the document picked up the trip
    // details panel and prefixed the first message with the mileage
    // allowance.
    let root =
      document.querySelector('div[class*="conversationInnerContainerStyles"]') ?? bubbles[0];
    while (root && !bubbles.every((bubble) => root.contains(bubble))) root = root.parentElement;
    if (!root) return { error: "no-root" };

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    const messages = [];
    let day = null;
    let buffer = [];

    while (walker.nextNode()) {
      const el = walker.currentNode;
      if (el.children.length !== 0) continue;
      const text = (el.textContent || "").trim();
      if (!text) continue;

      if (DAY.test(text)) {
        day = text;
        buffer = [];
        continue;
      }

      const attribution = text.match(ATTRIBUTION);
      if (attribution) {
        const body = buffer.join("\n").trim();
        buffer = [];
        if (body) {
          messages.push({
            day,
            time: attribution[1],
            author: attribution[2],
            role: attribution[3],
            body,
          });
        }
        continue;
      }

      // Composer furniture, not conversation.
      if (text.length > 1 && !/^(View message options|Insert a new line)/i.test(text)) {
        buffer.push(text);
      }
    }

    return { messages };
  });

  if (result.error === "no-bubbles") {
    throw new Error(
      `No message bubbles on ${reservationId}. Either the thread is genuinely empty or ` +
        `Turo's markup moved -- rerun with --headed and check ` +
        `div[class*="messageOuterContainerStyles"] still exists.`,
    );
  }
  if (result.error) {
    throw new Error(`Could not locate the conversation on ${reservationId} (${result.error}).`);
  }

  return result.messages
    .map((message) => {
      const sentAt = toIsoDate(message.day, message.time);
      if (!sentAt) return null;
      return {
        direction: /guest/i.test(message.role) ? "inbound" : "outbound",
        authorName: `${message.author} (${message.role})`.slice(0, 120),
        body: message.body.slice(0, 4000),
        sentAt,
      };
    })
    .filter(Boolean);
}

/**
 * "Wed, Aug 12, 2026" + "10:27 PM" -> ISO.
 *
 * Parsed in the machine's local timezone, which is the same one Turo
 * renders in for a signed-in host. Run the agent somewhere else and
 * the timestamps shift, which is worth knowing before wondering why a
 * message looks eight hours early.
 */
function toIsoDate(day, time) {
  if (!day || !time) return null;

  let base;
  if (/^Today$/i.test(day)) {
    base = new Date();
  } else if (/^Yesterday$/i.test(day)) {
    base = new Date();
    base.setDate(base.getDate() - 1);
  } else {
    base = new Date(day.replace(/^[A-Z][a-z]{2},\s*/, ""));
  }
  if (Number.isNaN(base.getTime())) return null;

  const match = time.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;

  let hours = Number(match[1]) % 12;
  if (/pm/i.test(match[3])) hours += 12;

  base.setHours(hours, Number(match[2]), 0, 0);
  return base.toISOString();
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
