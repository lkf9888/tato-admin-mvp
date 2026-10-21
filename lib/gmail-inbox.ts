import "server-only";

import { InboundEmailKind } from "@prisma/client";
import { ImapFlow } from "imapflow";
import { simpleParser, type ParsedMail } from "mailparser";

import { getDiskUsage } from "@/lib/disk";
import { kimiExtractJson, isKimiConfigured,
  kimiChat,
  getExtractionModel,
} from "@/lib/kimi";
import { prisma } from "@/lib/prisma";
import { NOTIFICATION_CATEGORIES, type NotificationCategory } from "@/lib/notifications";
import { TURO_ARCHIVE_LABEL, turoMailRule } from "@/lib/turo-mail-rules";
import { notifyCategory } from "@/lib/web-push";
import { pushNewGuestMessages } from "@/lib/guest-message-push";
import { applyTuroEmailsToOrders, type ApplyOutcome } from "@/lib/turo-email-apply";
import {
  classifyTuroSubject,
  extractGuestAvatar,
  extractGuestMessageText,
  extractTuroLink,
} from "@/lib/turo-subjects";
import {
  matchVehiclesForEmail,
  pickOrderForMessage,
  type VehicleForMatch,
} from "@/lib/turo-message-match";

/**
 * Turo → TATO event ingestion over Gmail IMAP.
 *
 * Turo closed its public API in April 2023 and offers hosts no
 * webhooks, but it still emails every material event: guest messages,
 * bookings created / modified / cancelled, trip start and end, payouts,
 * and support notices. Those land in the operator's Gmail. Reading that
 * mailbox is the only near-real-time channel Turo leaves open.
 *
 * CREDENTIAL HANDLING — deliberate choices:
 *
 *  - The Gmail password lives in an environment variable, never in the
 *    database. Railway's env store is already a secret store; putting a
 *    mailbox credential in a SQLite column would repeat the mistake
 *    `TuroSyncConfig.csvAuthHeader` makes today (plaintext, and a DB
 *    leak becomes a mailbox takeover).
 *  - It must be a Gmail **App Password**, not the account password.
 *    Google requires 2-Step Verification to issue one, and it can be
 *    revoked independently without touching the account.
 *  - The IMAP search is scoped to Turo's sending domains. This process
 *    holds a credential that *could* read the whole mailbox, so it
 *    should read as little as possible; `GMAIL_ALLOWED_SENDERS` is the
 *    blast-radius control.
 */

const DEFAULT_MAILBOX = "INBOX";
const DEFAULT_ALLOWED_SENDERS = ["turo.com"];
const DEFAULT_LOOKBACK_DAYS = 7;
const DEFAULT_MAX_MESSAGES = 100;
/** Turo emails are short. Anything past this is quoted history. */
const MAX_BODY_CHARS = 8_000;

export class GmailInboxError extends Error {
  code: string;
  status: number;

  constructor(message: string, code: string, status = 400) {
    super(message);
    this.name = "GmailInboxError";
    this.code = code;
    this.status = status;
  }
}

export function getGmailConfig() {
  const user = process.env.GMAIL_IMAP_USER?.trim() || "";
  // Google displays App Passwords grouped as `xxxx xxxx xxxx xxxx` for
  // readability, and the spaces come along when you copy them. The real
  // password is the 16 characters without spaces. Some IMAP servers
  // tolerate the spaces and some reject the login outright, so strip
  // all whitespace rather than depending on which.
  const password = (process.env.GMAIL_IMAP_PASSWORD ?? "").replace(/\s+/g, "");
  const host = process.env.GMAIL_IMAP_HOST?.trim() || "imap.gmail.com";
  const port = Number.parseInt(process.env.GMAIL_IMAP_PORT?.trim() || "993", 10);
  const mailbox = process.env.GMAIL_IMAP_MAILBOX?.trim() || DEFAULT_MAILBOX;

  const allowedSenders = (process.env.GMAIL_ALLOWED_SENDERS?.trim() || "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  return {
    user,
    password,
    host,
    port: Number.isFinite(port) ? port : 993,
    mailbox,
    allowedSenders: allowedSenders.length > 0 ? allowedSenders : DEFAULT_ALLOWED_SENDERS,
  };
}

export type TuroMailbox = ReturnType<typeof getGmailConfig> & {
  /** "gmail" for the primary inbox, "mailbox2" for the second. */
  key: string;
  /** The Turo account this inbox belongs to, for mail that names none.
   *  Null is the main account (the primary inbox). */
  turoAccount: string | null;
  primary: boolean;
};

/**
 * Every inbox Turo mail arrives in.
 *
 * The primary is the operator's own Gmail (GMAIL_IMAP_*). A second
 * inbox belongs to a co-hosted account -- Kevin's Yahoo -- whose own
 * Turo mail (support, claims, invoices, payouts) reaches nobody else:
 *   MAILBOX2_IMAP_USER, MAILBOX2_IMAP_PASSWORD (an app password),
 *   MAILBOX2_IMAP_HOST (default imap.mail.yahoo.com), MAILBOX2_IMAP_PORT,
 *   MAILBOX2_TURO_ACCOUNT (the account key on its cars, e.g. "kevin").
 */
export function getMailboxes(): TuroMailbox[] {
  const boxes: TuroMailbox[] = [];
  const primary = getGmailConfig();
  if (primary.user && primary.password) boxes.push({ ...primary, key: "gmail", turoAccount: null, primary: true });
  const user = process.env.MAILBOX2_IMAP_USER?.trim() || "";
  const password = (process.env.MAILBOX2_IMAP_PASSWORD ?? "").replace(/\s+/g, "");
  if (user && password) {
    const port = Number.parseInt(process.env.MAILBOX2_IMAP_PORT?.trim() || "993", 10);
    boxes.push({
      key: "mailbox2",
      user,
      password,
      host: process.env.MAILBOX2_IMAP_HOST?.trim() || "imap.mail.yahoo.com",
      port: Number.isFinite(port) ? port : 993,
      mailbox: DEFAULT_MAILBOX,
      allowedSenders: primary.allowedSenders,
      turoAccount: process.env.MAILBOX2_TURO_ACCOUNT?.trim().toLowerCase() || null,
      primary: false,
    });
  }
  return boxes;
}

export function isGmailInboxConfigured() {
  return getMailboxes().length > 0;
}

function getLookbackDays() {
  const raw = Number.parseInt(process.env.GMAIL_LOOKBACK_DAYS?.trim() || "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_LOOKBACK_DAYS;
}

function getMaxMessages() {
  const raw = Number.parseInt(process.env.GMAIL_MAX_MESSAGES?.trim() || "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_MESSAGES;
}

function senderAllowed(address: string, allowedSenders: string[]) {
  const normalized = address.toLowerCase();
  return allowedSenders.some(
    (allowed) => normalized === allowed || normalized.endsWith(`@${allowed}`) || normalized.endsWith(`.${allowed}`),
  );
}

/**
 * Collapse a plain-text email body down to the part that carries new
 * information: strip quoted history, signature blocks, and the long
 * legal footer Turo appends, then cap the length.
 */
function condenseBody(text: string) {
  const withoutQuotes = text
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith(">"))
    .join("\n");

  const cutMarkers = [
    /^On .+ wrote:$/m,
    /^-{2,}\s*Original Message\s*-{2,}$/im,
    /^_{5,}$/m,
    /^Turo Inc\./im,
  ];

  let body = withoutQuotes;
  for (const marker of cutMarkers) {
    const match = body.match(marker);
    if (match?.index != null) {
      body = body.slice(0, match.index);
    }
  }

  return body.replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_BODY_CHARS);
}

export type ParsedTuroEmail = {
  kind: InboundEmailKind;
  reservationId?: string | null;
  guestName?: string | null;
  vehicle?: string | null;
  tripStart?: string | null;
  tripEnd?: string | null;
  amount?: number | null;
  /** One-sentence plain-language summary for the alert feed. */
  summary: string;
  /** The same sentence in Chinese. Produced by the extraction call
   *  rather than a separate translation pass: the model is already
   *  reading this email and writing that sentence, so the Chinese
   *  costs nothing beyond a few output tokens. A second call per
   *  email, for one line, would have doubled the sync's model
   *  budget for no additional understanding. */
  summaryZh?: string | null;
  /** Whether this needs the operator to do something. */
  needsAction: boolean;
};

const EXTRACTION_SYSTEM_PROMPT = `You classify and extract data from Turo host notification emails.

Return ONLY a JSON object with these keys:
{
  "kind": one of "GUEST_MESSAGE" | "BOOKING_CREATED" | "BOOKING_MODIFIED" | "BOOKING_CANCELLED" | "TRIP_STARTED" | "TRIP_ENDED" | "PAYOUT" | "SUPPORT" | "OTHER",
  "reservationId": string or null,
  "guestName": string or null,
  "vehicle": string or null,
  "tripStart": ISO 8601 string or null,
  "tripEnd": ISO 8601 string or null,
  "amount": number or null,
  "summary": one short sentence describing what happened,
  "summaryZh": the same sentence in Simplified Chinese,
  "needsAction": true if the host must reply or act, false otherwise
}

Rules:
- Use null for anything the email does not state. Never guess a value.
- "needsAction" is true for guest messages awaiting a reply, and for
  anything asking the host to confirm, approve, or provide something.
  It is false for pure notifications like payout confirmations.
- Write "summary" in the same language as the email.
- "summaryZh" is always Simplified Chinese, whatever the email is in.
  It is read at a glance in a feed, so say what happened and to which
  car or guest, not that a notification arrived: "Andrew 把 Dodge Grand
  Caravan 的取车改到 8/20 23:30", not "收到一封行程变更通知".`;

/**
 * How much of the body the model actually sees.
 *
 * The full 8k is kept in the database for display and search, but a
 * Turo notification says what it has to say in the first paragraph --
 * the rest is footer, legal text and unsubscribe links. Prompt length
 * drives latency directly on a reasoning model, and latency is what
 * decides how many messages fit in a sync run's budget.
 */
const MODEL_BODY_CHARS = 2_000;

async function extractTuroEmail(input: {
  subject: string;
  fromName: string | null;
  bodyText: string;
}): Promise<{ ok: true; data: ParsedTuroEmail } | { ok: false; reason: string }> {
  if (!isKimiConfigured()) return { ok: false, reason: "kimi_not_configured" };

  const result = await kimiExtractJson<ParsedTuroEmail>({
    system: EXTRACTION_SYSTEM_PROMPT,
    user: [
      `Subject: ${input.subject}`,
      input.fromName ? `From: ${input.fromName}` : "",
      "",
      input.bodyText.slice(0, MODEL_BODY_CHARS),
    ]
      .filter(Boolean)
      .join("\n"),
    // 2048 was enough for most notifications and not for all: the
    // reasoning pass spent the whole budget on the harder ones and
    // returned empty, the same failure v0.27.1 hit at 600. Reasoning
    // length varies per message, so the budget has to clear the worst
    // case, not the median. Only tokens actually emitted are billed,
    // so headroom is close to free.
    maxTokens: 8192,
    // 45s cut off calls that were nearly done. A reasoning model
    // answering with JSON routinely needs longer than that.
    timeoutMs: 90_000,
  });

  if (!result.ok) return result;
  const parsed = result.data;

  // Trust the model's extraction but not its enum spelling.
  const kind = Object.values(InboundEmailKind).includes(parsed.kind)
    ? parsed.kind
    : InboundEmailKind.OTHER;

  return {
    ok: true,
    data: {
      ...parsed,
      kind,
      summary: typeof parsed.summary === "string" ? parsed.summary.slice(0, 400) : "",
      summaryZh: typeof parsed.summaryZh === "string" ? parsed.summaryZh.slice(0, 400) : null,
      needsAction: parsed.needsAction === true,
    },
  };
}

export type GmailSyncResult = {
  scanned: number;
  imported: number;
  skippedDuplicate: number;
  skippedSender: number;
  parsed: number;
  parseFailed: number;
  /** Historical rows healed by the subject classifier this run. */
  reclassified: number;
  /** Guest messages pushed to the operator's phone this run. */
  guestMessagesPushed?: number;
  /** Filed emails moved to Gmail's Trash this run. */
  trashed?: number;
  /** Support and claim emails moved under the "Turo客服" label this run. */
  archived?: number;
  /** A secondary inbox that could not be read this run, and why. */
  mailboxErrors?: string[];
  /** History run: old guest messages still to import after this one.
   *  Zero means the history is all in. */
  historyRemaining?: number;
  /** History run: matching mail it could neither import nor clear. */
  historySkipped?: { noMessageId: number; storedOtherKind: number; notGuestSubject: number };
  /** History run: how full the volume was when it started. */
  diskUsedPercent?: number | null;
  /** History run: set when it imported nothing because the volume is
   *  too full to grow the database safely. */
  historyPaused?: "disk";
  /** What the booking mail did to orders on this run. */
  orders?: ApplyOutcome;
  /** Messages still waiting for a summary after this run's budget ran
   *  out. Drains over subsequent runs; non-zero is normal after a
   *  burst, persistently large means the schedule is too slow. */
  enrichRemaining: number;
  /** Distinct reasons extraction failed this run, verbatim from the
   *  model client. Empty is the healthy state. */
  enrichErrors: string[];
};

/**
 * Everything a notification can be attributed to without asking a
 * model: who wrote it, which car it is about, which trip, and the link
 * back to Turo.
 *
 * Runs at ingest and again over stored rows, so history and new mail
 * are attributed by identical logic rather than two versions of it.
 */
async function attributeEmail(input: {
  workspaceId: string;
  subject: string;
  bodyText: string;
  receivedAt: Date;
  fleet: VehicleForMatch[];
  /** The account of the inbox it came from, for a subject that names
   *  none: Kevin's own mail carries no "(kevin's vehicles)" prefix. */
  defaultAccount?: string | null;
}) {
  const bySubject = classifyTuroSubject(input.subject);
  const turoLink = extractTuroLink(input.bodyText);
  const guestText = extractGuestMessageText(input.bodyText, input.subject);
  // A prefix naming an account no car is filed under is the main
  // account seen from a co-host's inbox: Kevin's Yahoo gets SpeedX's
  // mail as "(SPEEDX's vehicle) - ...", and the main account's cars
  // carry no account at all.
  const prefixAccount = bySubject?.coHostAccount ?? null;
  const knownPrefix = prefixAccount && input.fleet.some((vehicle) => vehicle.turoAccount === prefixAccount);
  const account = prefixAccount
    ? knownPrefix || !input.defaultAccount
      ? prefixAccount
      : null
    : (input.defaultAccount ?? null);

  const matchedVehicles = bySubject?.vehicleText
    ? matchVehiclesForEmail(bySubject.vehicleText, input.fleet, account).matches
    : [];

  // One vehicle is an identification; several is only a narrowing, and
  // is left null rather than guessed. The order match still uses the
  // full set to filter candidates.
  const vehicleId = matchedVehicles.length === 1 ? matchedVehicles[0].id : null;

  let orderId: string | null = null;

  if (bySubject?.guestName) {
    // SQLite's LIKE is case-insensitive for ASCII, which is what
    // `contains` compiles to -- enough to shortlist before the real
    // comparison runs in `pickOrderForMessage`. The first token only,
    // since Turo shows "Fatima" where the CSV may hold "Fatima Zahra".
    const firstToken = bySubject.guestName.split(/\s+/)[0] ?? "";
    if (firstToken.length >= 2) {
      const candidates = await prisma.order.findMany({
        where: {
          workspaceId: input.workspaceId,
          isArchived: false,
          renterName: { contains: firstToken },
        },
        select: {
          id: true,
          renterName: true,
          vehicleId: true,
          pickupDatetime: true,
          returnDatetime: true,
        },
        take: 100,
      });

      orderId = pickOrderForMessage({
        guestName: bySubject.guestName,
        vehicleIds: matchedVehicles.map((vehicle) => vehicle.id),
        receivedAt: input.receivedAt,
        candidates,
      });
    }
  }

  return {
    kind: bySubject?.kind ?? InboundEmailKind.OTHER,
    guestName: bySubject?.guestName ?? null,
    guestText,
    turoAccount: account,
    vehicleId,
    turoLink,
    orderId,
  };
}

/**
 * Pull recent Turo mail into `InboundEmail`.
 *
 * Idempotent: dedupes on (workspaceId, Message-ID), so overlapping runs
 * and IMAP replays are harmless. Safe to schedule as often as the
 * operator wants fresh data.
 */
export async function runGmailSync(input: {
  workspaceId: string;
  /** One-off deeper reach for the historical backfill. The scheduled
   *  runs stay on the short default: scanning ten years of mailbox
   *  every fifteen minutes would spend most of its time re-reading
   *  messages it already has. */
  lookbackDays?: number;
  /** Companion to `lookbackDays`. Widening the window alone does
   *  nothing, because the cap takes the newest N and those are exactly
   *  the messages already stored -- a 365-day run scanned 100 and
   *  imported one. */
  maxMessages?: number;
  /**
   * What this run is for.
   *
   * Reading the mailbox takes about three seconds; summarising what
   * arrived takes minutes. Bundled, the schedule has to be paced for
   * the slow half, so a message can sit unseen for a quarter of an
   * hour while a model finishes describing older mail.
   *
   * "ingest" reads and files, touching no model. "enrich" runs only
   * the model passes. "full" is both and remains the default, so
   * anything already calling this keeps its behaviour.
   */
  mode?: "ingest" | "enrich" | "full";
  /**
   * Bring in old conversations: guest messages from the last ten years,
   * up to 400 a run, newest first, filed as read. Each run clears what
   * it filed from the inbox, so run it until it imports nothing. Other
   * old Turo mail is not imported (see ingestMailbox).
   */
  history?: boolean;
}): Promise<GmailSyncResult> {
  const mode = input.mode ?? "full";
  const mailboxes = getMailboxes();
  if (mailboxes.length === 0) {
    throw new GmailInboxError(
      "Set GMAIL_IMAP_USER and GMAIL_IMAP_PASSWORD (a Gmail App Password) before syncing the Turo inbox.",
      "GMAIL_NOT_CONFIGURED",
      400,
    );
  }

  const result: GmailSyncResult = {
    scanned: 0,
    imported: 0,
    skippedDuplicate: 0,
    skippedSender: 0,
    parsed: 0,
    parseFailed: 0,
    reclassified: 0,
    enrichRemaining: 0,
    enrichErrors: [],
  };

  // Loaded once and reused for every message: the fleet is ~100 rows
  // and does not change during a sync.
  const fleet = await prisma.vehicle.findMany({
    // Archived cars included: a guest writing about a trip the car ran
    // before it was archived has to find that trip, and with the car
    // left out a twin would answer to the model instead. New bookings
    // are kept off archived cars where they are placed, in
    // `applyTuroEmailsToOrders`.
    where: { workspaceId: input.workspaceId },
    select: {
      id: true,
      brand: true,
      model: true,
      year: true,
      nickname: true,
      turoListingName: true,
      turoAccount: true,
    },
  });

  // The history import grows the database by tens of megabytes a run,
  // and a full volume took the site down for nine hours (2026-10-19):
  // SQLite could not write and the next deploy failed its healthcheck.
  // So each history run looks first and stands down well before full,
  // leaving room for deploy snapshots. New mail is never held back.
  let historyAllowed = true;
  if (input.history) {
    const disk = await getDiskUsage();
    result.diskUsedPercent = disk?.usedPercent ?? null;
    if (!disk || disk.usedPercent >= HISTORY_MAX_DISK_PERCENT) {
      result.historyPaused = "disk";
      historyAllowed = false;
    }
  }

  if (mode !== "enrich" && historyAllowed) {
    const ingestStartedAt = Date.now();
    // One inbox failing (a revoked app password) must not stop the
    // others: the primary is where guests write.
    for (const config of mailboxes) {
      try {
        // Yahoo answers a search with its newest 1,000 matches and no
        // more, so one pass of the history run could clear 1,000 copies
        // at most. While a pass cleared something out of a full answer,
        // search again: the next thousand are underneath.
        for (;;) {
          const pass = await ingestMailbox({
            workspaceId: input.workspaceId,
            lookbackDays: input.lookbackDays,
            maxMessages: input.maxMessages,
            history: input.history,
            startedAt: ingestStartedAt,
            config,
            fleet,
            result,
          });
          if (!input.history || pass.searched < SEARCH_RESULT_CAP || pass.moved === 0) break;
          if (Date.now() - ingestStartedAt > HISTORY_BUDGET_MS) break;
        }
      } catch (error) {
        if (config.primary) throw error;
        result.mailboxErrors = [
          ...(result.mailboxErrors ?? []),
          `${config.key}: ${error instanceof Error ? error.message : String(error)}`.slice(0, 200),
        ];
      }
    }
  }

  // Order of these three is the whole point, and it used to be wrong.
  //
  // A guest message is attributed to a trip at the moment it is
  // ingested, by looking for an order whose renter and dates fit. So
  // the order has to exist by then. Booking mail creates orders --
  // but that step ran in the API route, after this function had
  // already returned, while re-attribution ran *before* ingestion.
  //
  // For mail that arrives together, which is exactly what happens
  // when someone books and then immediately writes to ask about
  // pickup, that sequence never resolved: the booking became an order
  // only after the message had already been filed as "no trip", and
  // the message was not looked at again until the next run.
  //
  // Now it reads: file the new mail, turn booking mail into orders,
  // then heal anything still unattributed. A booking and a message in
  // the same batch resolve in the same run.
  const applyStartedAt = new Date();
  result.orders = await applyTuroEmailsToOrders({
    workspaceId: input.workspaceId,
    apply: true,
    actor: "turo-email-sync",
  });
  // A booking that arrived, or a trip cancelled, is news for the phone.
  // Never throws: a notification is not worth failing the sync for.
  if (result.orders.created > 0 || result.orders.updated > 0) {
    await notifyBookingChanges(input.workspaceId, applyStartedAt).catch((error) =>
      console.error("[gmail-inbox] booking notification failed", error),
    );
  }

  // Rows imported while the model was failing all landed as OTHER,
  // which made the guest-message alert detector -- it selects on kind
  // -- report an empty fleet while guests were waiting. Needs no
  // network and no model, so it runs even when no new mail arrived.
  result.reclassified = await reclassifyBySubject(input.workspaceId, fleet);

  // The moment a guest message is filed, tell the operator's phone.
  // After the subject pass, because that is what marks a row as a guest
  // message without waiting for the model. Never throws.
  result.guestMessagesPushed = (await pushNewGuestMessages({ workspaceId: input.workspaceId })).pushed;

  if (mode !== "ingest") {
    await enrichPendingEmails(
      input.workspaceId,
      result,
      Date.now() + POST_INGEST_BUDGET_MS,
    );
  }

  return result;
}

/**
 * Whether a guest-message email leaves the mailbox once TATO has it.
 *
 * On by default: Turo sends one notification per guest message, the
 * operator's inbox drowned in them, and everything TATO reads from one
 * -- the text, the guest, the car, the link back to Turo -- is copied
 * into its row at ingest. Nothing later goes back to Gmail for it.
 * Moved to Gmail's Trash rather than deleted outright, so a mistake has
 * Gmail's thirty days to be undone. Only guest messages: booking mail
 * stays where it is. `GMAIL_TRASH_GUEST_MESSAGES=false` turns it off.
 */
function trashGuestMessagesEnabled() {
  return process.env.GMAIL_TRASH_GUEST_MESSAGES?.trim().toLowerCase() !== "false";
}

/**
 * Where a stored Turo email goes, per lib/turo-mail-rules: Trash, the
 * support label, or nowhere yet. Security codes wait a day.
 */
function dispositionFor(subject: string, receivedAt: Date | null | undefined): "trash" | "archive" | null {
  const rule = turoMailRule(subject);
  if (rule.disposition === "trash") return "trash";
  if (rule.disposition === "archive") return "archive";
  if (rule.disposition === "trash_later") {
    return receivedAt && Date.now() - receivedAt.getTime() > 24 * 3_600_000 ? "trash" : null;
  }
  return null;
}

type MailNotice = { category: NotificationCategory; label: string; subject: string };

/** New Turo mail worth a push, one notification per category per run. */
async function sendMailNotices(workspaceId: string, notices: MailNotice[]) {
  const byCategory = new Map<NotificationCategory, MailNotice[]>();
  for (const notice of notices) byCategory.set(notice.category, [...(byCategory.get(notice.category) ?? []), notice]);
  for (const [category, list] of byCategory) {
    const name = NOTIFICATION_CATEGORIES.find((item) => item.key === category)?.zh ?? "Turo";
    const clean = (subject: string) => subject.replace(/^\([^)]*\)\s*[-–—]\s*/, "").slice(0, 110);
    await notifyCategory(workspaceId, category, {
      title: list.length === 1 ? list[0].label : `${list.length} 封${name}`,
      body: list
        .slice(0, 4)
        .map((notice) => (list.length === 1 ? clean(notice.subject) : `· ${clean(notice.subject)}`))
        .join("\n"),
      url: "/updates",
      tag: `mail-${category}`,
    });
  }
}

/** The history run stops at this much volume use. */
const HISTORY_MAX_DISK_PERCENT = 70;

/** How far back the history run reaches, and how much it takes a run. */
const HISTORY_LOOKBACK_DAYS = 3650;
const HISTORY_MAX_MESSAGES = 1500;
/** Envelopes the history run reads at most, looking past mail it
 *  cannot import or clear. */
const HISTORY_MAX_ENVELOPES = 30_000;
/** Whole messages are downloaded this many at a time, so the history
 *  run can stop between batches when its time is up. */
const SOURCE_BATCH = 200;
/** The history run stops starting batches after this long. What it has
 *  filed by then is cleared from the inbox and the rest waits for the
 *  next run, well inside Railway's 300s gateway. */
const HISTORY_BUDGET_MS = 170_000;
/** Turo's guest-message subject, as IMAP can search for it. The history
 *  run asks for these only: reading every Turo envelope -- 90,000 of
 *  them in the first mailbox -- took most of the gateway's time. */
const GUEST_MESSAGE_SUBJECT = "has sent you a message about your";
/** The most matches Yahoo returns for one IMAP search (Gmail has no cap). */
const SEARCH_RESULT_CAP = 1000;

/** The mailbox Gmail calls Trash, whatever the account's language. */
async function findTrashMailbox(client: ImapFlow) {
  const boxes = await client.list();
  return boxes.find((box) => box.specialUse === "\\Trash")?.path ?? null;
}

async function ingestMailbox(input: {
  workspaceId: string;
  lookbackDays?: number;
  maxMessages?: number;
  /** The history run: see `runGmailSync`. */
  history?: boolean;
  /** When the run began; the history budget counts from here across passes. */
  startedAt?: number;
  config: TuroMailbox;
  fleet: VehicleForMatch[];
  result: GmailSyncResult;
}): Promise<{ searched: number; moved: number }> {
  const { config, fleet, result } = input;
  const startedAt = input.startedAt ?? Date.now();
  let searched = 0;
  let moved = 0;
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: true,
    auth: { user: config.user, pass: config.password },
    logger: false,
  });

  try {
    await client.connect();
  } catch (error) {
    throw new GmailInboxError(
      "Could not connect to Gmail. Check the address and App Password.",
      "GMAIL_CONNECT_FAILED",
      502,
    );
  }

  const notices: MailNotice[] = [];
  const lock = await client.getMailboxLock(config.mailbox);
  try {
    const since = new Date();
    since.setDate(
      since.getDate() - (input.history ? HISTORY_LOOKBACK_DAYS : (input.lookbackDays ?? getLookbackDays())),
    );

    // Turo's mail only. Searching every sender let the rest of the
    // inbox use up the cap, which a long backfill window made worse:
    // the newest N of all mail may hold few or no Turo messages. The
    // sender check below still runs; this only narrows the search.
    const senderTerms = config.allowedSenders.map((sender) => ({ from: sender }));
    const query = {
      since,
      ...(senderTerms.length === 1 ? senderTerms[0] : { or: senderTerms }),
      ...(input.history ? { subject: GUEST_MESSAGE_SUBJECT } : {}),
    };
    const uids = await client.search(query, { uid: true });
    if (!uids || uids.length === 0) {
      return { searched: 0, moved: 0 };
    }
    searched = uids.length;

    // Newest first, capped — a first run against a busy mailbox should
    // not try to ingest years of history in one request. The history
    // run's search already holds guest messages only, and what it files
    // leaves the inbox, so its newest N are always the next batch.
    // (Reading all 55,000 envelopes each run left time for 400 messages.)
    const cap = input.maxMessages ?? (input.history ? HISTORY_MAX_MESSAGES : getMaxMessages());

    // Pre-load the ids we already have, so the common case -- a poll
    // that finds nothing new -- costs one query rather than one per
    // message.
    //
    // Every stored id, not the newest 500. The cap was invisible while
    // the mailbox held less than that; the moment a backfill pushes it
    // past, dedupe starts missing and every miss becomes a unique
    // constraint violation on insert. Ids are short strings -- ten
    // thousand of them is a rounding error next to the message bodies
    // this function is already holding. The kind comes along to know
    // which stored ones are guest messages to clear from the inbox.
    const existing = await prisma.inboundEmail.findMany({
      where: { workspaceId: input.workspaceId },
      select: { messageId: true, kind: true },
    });
    const storedKind = new Map(existing.map((row) => [row.messageId, row.kind]));

    // Two passes: envelopes first, which are small, then whole messages
    // only for what is new. Re-reading every stored message's source
    // to learn it was a duplicate made the history run slow for nothing.
    //
    // Envelopes are read a window at a time from the newest end. A
    // normal run reads one window -- the newest `cap`. The history run
    // keeps going to older windows until it has `cap` new messages:
    // mail that matches the search but is neither new nor clearable (no
    // Message-ID, stored as another kind, a subject the classifier does
    // not take) stays in the inbox, and one window of it at the top
    // stopped every later run cold.
    const fresh: number[] = [];
    const toTrash: number[] = [];
    const toArchive: number[] = [];
    let freshTotal = 0;
    let end = uids.length;
    let envelopesRead = 0;
    const skipped = { noMessageId: 0, storedOtherKind: 0, notGuestSubject: 0 };
    while (end > 0) {
      const start = Math.max(0, end - cap);
      const window = uids.slice(start, end);
      end = start;
      envelopesRead += window.length;
      const windowFresh: number[] = [];
      for await (const message of client.fetch(window, { uid: true, envelope: true }, { uid: true })) {
        const messageId = message.envelope?.messageId?.trim();
        if (!messageId) {
          skipped.noMessageId += 1;
          continue;
        }
        const subjectKind = classifyTuroSubject(message.envelope?.subject ?? "")?.kind;
        const kind = storedKind.get(messageId);
        if (kind) {
          result.skippedDuplicate += 1;
          // Stored, and a guest message by its row or by its subject (a
          // row filed as OTHER while the model was failing is still one).
          if (kind === InboundEmailKind.GUEST_MESSAGE || subjectKind === InboundEmailKind.GUEST_MESSAGE) {
            toTrash.push(message.uid);
          } else if (!input.history) {
            // Any other Turo mail TATO already has: cleared by its rule.
            const where = dispositionFor(message.envelope?.subject ?? "", message.envelope?.date);
            if (where === "trash") toTrash.push(message.uid);
            else if (where === "archive") toArchive.push(message.uid);
          } else {
            skipped.storedOtherKind += 1;
          }
          continue;
        }
        const fromAddress = message.envelope?.from?.[0]?.address?.trim().toLowerCase() ?? "";
        if (!senderAllowed(fromAddress, config.allowedSenders)) {
          result.skippedSender += 1;
          continue;
        }
        // The history run is for conversations. Old booking mail is left
        // alone: turned into orders now, years-old changes and
        // cancellations would be replayed onto trips the CSV already got
        // right.
        if (input.history && subjectKind !== InboundEmailKind.GUEST_MESSAGE) {
          skipped.notGuestSubject += 1;
          continue;
        }
        windowFresh.push(message.uid);
      }
      freshTotal += windowFresh.length;
      // Newest first: within a window the uids ascend, so the newest
      // are at its end.
      fresh.push(...windowFresh.slice(-Math.max(0, cap - fresh.length)));
      if (!input.history || fresh.length >= cap) break;
      if (envelopesRead >= HISTORY_MAX_ENVELOPES || Date.now() - startedAt > HISTORY_BUDGET_MS / 2) break;
    }
    result.scanned += envelopesRead;
    if (input.history) result.historySkipped = skipped;
    let downloaded = 0;

    // Anything older than the normal window is history: filed as read,
    // or a backfill would put a thousand long-finished conversations
    // at the top of "needs reply".
    const historyBefore = new Date();
    historyBefore.setDate(historyBefore.getDate() - getLookbackDays());

    for (let start = 0; start < fresh.length; start += SOURCE_BATCH) {
      if (input.history && Date.now() - startedAt > HISTORY_BUDGET_MS) break;
      const batch = fresh.slice(start, start + SOURCE_BATCH);
      downloaded += batch.length;
      for await (const message of client.fetch(batch, { uid: true, envelope: true, source: true }, { uid: true })) {
        const envelope = message.envelope;
        const messageId = envelope?.messageId?.trim();
        if (!messageId) continue;

        if (storedKind.has(messageId)) {
          result.skippedDuplicate += 1;
          continue;
        }

        const fromAddress = envelope?.from?.[0]?.address?.trim().toLowerCase() ?? "";

        // `source` is only present because we asked for it in the fetch
        // options, but the type is optional — skip rather than assert, so
        // a server that declines to return it degrades to "no new mail"
        // instead of throwing mid-loop.
        if (!message.source) continue;

        const parsedMail: ParsedMail = await simpleParser(message.source);
        const bodyText = condenseBody(parsedMail.text ?? "");
        // The HTML part is read for the avatar and then dropped. Storing
        // it would multiply this table's size for one URL.
        const avatarUrl = extractGuestAvatar(
          typeof parsedMail.html === "string" ? parsedMail.html : "",
        );
        const subject = (envelope?.subject ?? parsedMail.subject ?? "").slice(0, 500);
        const fromName = envelope?.from?.[0]?.name?.trim() || null;
        const receivedAt = envelope?.date ?? parsedMail.date ?? new Date();

        // No model call on this path. Attribution comes from the subject
        // and the body, which are exact for Turo's templates and cost
        // nothing; summaries are filled in by the bounded enrichment
        // pass after the mailbox is drained. Calling the model here is
        // what made this endpoint exceed the 300s gateway timeout and
        // fail the whole sync.
        const attribution = await attributeEmail({
          workspaceId: input.workspaceId,
          subject,
          bodyText,
          receivedAt,
          fleet,
          defaultAccount: config.turoAccount,
        });

        // A co-hosted account's own inbox repeats what the primary
        // already gets as the co-host's copy -- "(kevin's vehicles) - ..."
        // -- for bookings and guest messages. Bookings from here are not
        // stored: the booking fold places a trip by the subject's account,
        // and this inbox's subjects name none. Guest messages are stored
        // only when the primary's copy is not already there.
        if (!config.primary) {
          const bookingKind =
            attribution.kind === InboundEmailKind.BOOKING_CREATED ||
            attribution.kind === InboundEmailKind.BOOKING_MODIFIED ||
            attribution.kind === InboundEmailKind.BOOKING_CANCELLED ||
            attribution.kind === InboundEmailKind.TRIP_STARTED ||
            attribution.kind === InboundEmailKind.TRIP_ENDED;
          let copyExists = false;
          if (attribution.kind === InboundEmailKind.GUEST_MESSAGE && attribution.guestName) {
            // The other inbox's copy of the same message: same guest, sent
            // within two minutes, and the same subject once the co-host
            // prefix is taken off -- but not the same raw subject, because
            // one of the two carries the prefix ("(SPEEDX's vehicle) - ..."
            // here, "(kevin's vehicles) - ..." in the primary). Not the
            // text: the prefix changes what the extractor reads, and that
            // stored 8,284 copies twice (2026-10-20). Not a wider window
            // either: a guest's second message a few minutes later, with
            // the identical subject, is a real message.
            const bare = subject.replace(/^\([^)]*\)\s*[-–—]\s*/, "");
            const candidates = await prisma.inboundEmail.findMany({
              where: {
                workspaceId: input.workspaceId,
                kind: InboundEmailKind.GUEST_MESSAGE,
                guestName: attribution.guestName,
                receivedAt: {
                  gte: new Date(receivedAt.getTime() - 2 * 60_000),
                  lte: new Date(receivedAt.getTime() + 2 * 60_000),
                },
                NOT: { subject },
              },
              select: { subject: true },
              take: 10,
            });
            copyExists = candidates.some(
              (candidate) => candidate.subject.replace(/^\([^)]*\)\s*[-–—]\s*/, "") === bare,
            );
          }
          if (bookingKind || copyExists) {
            result.skippedDuplicate += 1;
            // Cleared once the primary has had time to store its copy.
            if (Date.now() - receivedAt.getTime() > CLEANUP_MIN_AGE_MS) toTrash.push(message.uid);
            continue;
          }
        }

        // Two runs overlapping, or an id that arrived after the pre-load,
        // both land here as a unique violation. That is a duplicate, not
        // a failure: count it and keep reading. Throwing would abandon
        // every message after it in the batch.
        try {
          await prisma.inboundEmail.create({
            data: {
              workspaceId: input.workspaceId,
              messageId,
              fromAddress,
              fromName,
              subject,
              receivedAt,
              bodyText,
              avatarUrl,
              ...attribution,
              acknowledgedAt:
                attribution.kind === InboundEmailKind.GUEST_MESSAGE && receivedAt < historyBefore ? new Date() : null,
              parsedAt: null,
              parsed: null,
            },
          });
        } catch {
          result.skippedDuplicate += 1;
          storedKind.set(messageId, attribution.kind);
          continue;
        }

        storedKind.set(messageId, attribution.kind);
        result.imported += 1;
        if (attribution.kind === InboundEmailKind.GUEST_MESSAGE) {
          toTrash.push(message.uid);
        } else if (!input.history) {
          // Stored now, so it can go -- and it may be news for the phone.
          const rule = turoMailRule(subject);
          if (rule.notify) notices.push({ category: rule.notify, label: rule.label, subject });
          const where = dispositionFor(subject, receivedAt);
          if (where === "trash") toTrash.push(message.uid);
          else if (where === "archive") toArchive.push(message.uid);
        }
      }
    }
    // Not yet looked at, plus new ones found but not downloaded this run.
    // Mail skipped as unclearable is not counted: it never will be.
    if (input.history) result.historyRemaining = end + (freshTotal - downloaded);

    // Only once the rows exist: a message moves out of the inbox after
    // TATO has it, never before. A failure here leaves the mail where
    // it was, and the next run tries again.
    if (toTrash.length > 0 && trashGuestMessagesEnabled()) {
      try {
        const trash = await findTrashMailbox(client);
        if (trash && trash !== config.mailbox) {
          const count = await moveInBatches(client, toTrash, trash);
          result.trashed = (result.trashed ?? 0) + count;
          moved += count;
        }
      } catch (error) {
        console.error("[gmail-inbox] moving filed mail to Trash failed", error);
      }
    }
    if (toArchive.length > 0 && trashGuestMessagesEnabled()) {
      try {
        await ensureMailbox(client, TURO_ARCHIVE_LABEL);
        const count = await moveInBatches(client, toArchive, TURO_ARCHIVE_LABEL);
        result.archived = (result.archived ?? 0) + count;
        moved += count;
      } catch (error) {
        console.error("[gmail-inbox] filing support mail under its label failed", error);
      }
    }
  } finally {
    lock.release();
    await client.logout().catch(() => null);
  }

  if (notices.length > 0) {
    await sendMailNotices(input.workspaceId, notices).catch((error) =>
      console.error("[gmail-inbox] mail notifications failed", error),
    );
  }
  return { searched, moved };
}

/**
 * Move mail in small batches, counting what Gmail says it moved.
 *
 * One MOVE of 1,500 UIDs came back OK with most of them still in the
 * inbox, so a single command's success says nothing about each message.
 * Batches of 100, and the count is the server's own map of moved UIDs.
 * (Yahoo acted on 100 of every 200 sent: each run's counts came out in
 * round hundreds, half of what it was asked to move.)
 */
async function moveInBatches(client: ImapFlow, uids: number[], destination: string) {
  let moved = 0;
  for (let start = 0; start < uids.length; start += MOVE_BATCH) {
    const batch = uids.slice(start, start + MOVE_BATCH);
    const response = await client.messageMove(batch, destination, { uid: true });
    moved += response && response.uidMap ? response.uidMap.size : 0;
  }
  return moved;
}

const MOVE_BATCH = 100;

/** A Gmail label to move mail under, created the first time. */
async function ensureMailbox(client: ImapFlow, path: string) {
  const boxes = await client.list();
  if (boxes.some((box) => box.path === path)) return;
  await client.mailboxCreate(path).catch(() => null);
}

/** How long one cleanup run keeps going before it reports back. */
const CLEANUP_BUDGET_MS = 200_000;
/** Mail younger than this is left for the sync to import first. */
const CLEANUP_MIN_AGE_MS = 2 * 24 * 3_600_000;

/**
 * Clear the Turo mail that piled up before the rules existed: the
 * one-off pass after the census. Moves only -- nothing is imported and
 * nothing is pushed, so years-old bookings are not replayed onto orders
 * and the phone does not hear about 2023. Mail TATO has not stored and
 * that is under two days old is left for the regular sync, which stores
 * it first. Newest first, a window at a time; run again until
 * `remaining` is 0.
 */
export async function cleanupMailbox(workspaceId: string, options: { purgeUnread?: boolean } = {}) {
  const startedAt = Date.now();
  const results: Record<string, Awaited<ReturnType<typeof cleanupOneMailbox>>> = {};
  for (const config of getMailboxes()) {
    if (Date.now() - startedAt > CLEANUP_BUDGET_MS) break;
    try {
      results[config.key] = await cleanupOneMailbox(workspaceId, config, startedAt, options.purgeUnread ?? false);
    } catch (error) {
      if (config.primary) throw error;
      results[config.key] = { error: error instanceof Error ? error.message : String(error) } as never;
    }
  }
  const all = Object.values(results).filter((item) => item && "scanned" in item);
  return {
    scanned: all.reduce((sum, item) => sum + item.scanned, 0),
    trashed: all.reduce((sum, item) => sum + item.trashed, 0),
    archived: all.reduce((sum, item) => sum + item.archived, 0),
    kept: all.reduce((sum, item) => sum + item.kept, 0),
    remaining: all.reduce((sum, item) => sum + item.remaining, 0),
    mailboxes: results,
  };
}

async function cleanupOneMailbox(workspaceId: string, config: TuroMailbox, startedAt: number, purgeUnread: boolean) {
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: true,
    auth: { user: config.user, pass: config.password },
    logger: false,
  });
  await client.connect();
  const stored = new Set(
    (await prisma.inboundEmail.findMany({ where: { workspaceId }, select: { messageId: true } })).map((row) => row.messageId),
  );
  const result = { scanned: 0, trashed: 0, archived: 0, kept: 0, remaining: 0, byGroup: {} as Record<string, number> };
  const lock = await client.getMailboxLock(config.mailbox);
  try {
    const trash = await findTrashMailbox(client);
    if (!trash) throw new GmailInboxError("No Trash mailbox found", "GMAIL_NO_TRASH", 500);
    await ensureMailbox(client, TURO_ARCHIVE_LABEL);
    const since = new Date();
    since.setDate(since.getDate() - HISTORY_LOOKBACK_DAYS);
    const senderTerms = config.allowedSenders.map((sender) => ({ from: sender }));
    // Search again after a pass that moved mail out of a full answer:
    // Yahoo returns the newest 1,000 matches only.
    let end = 0;
    for (;;) {
      const uids =
        (await client.search({ since, ...(senderTerms.length === 1 ? senderTerms[0] : { or: senderTerms }) }, { uid: true })) || [];
      const movedBefore = result.trashed + result.archived;
      end = uids.length;
      while (end > 0 && Date.now() - startedAt < CLEANUP_BUDGET_MS) {
        const start = Math.max(0, end - 2000);
        const window = uids.slice(start, end);
        end = start;
        const toTrash: number[] = [];
        const toArchive: number[] = [];
        for await (const message of client.fetch(window, { uid: true, envelope: true, flags: true }, { uid: true })) {
          result.scanned += 1;
          const subject = message.envelope?.subject ?? "";
          const date = message.envelope?.date ?? null;
          const isStored = Boolean(message.envelope?.messageId && stored.has(message.envelope.messageId.trim()));
          const oldEnough = Boolean(date && Date.now() - date.getTime() > CLEANUP_MIN_AGE_MS);
          const rule = turoMailRule(subject);
          result.byGroup[rule.group] = (result.byGroup[rule.group] ?? 0) + 1;
          // A guest message TATO lacks is history still to import, not junk.
          let where = rule.group === "guest" && !isStored ? null : dispositionFor(subject, date);
          // The final sweep the operator asked for: whatever Turo mail no
          // rule placed and nobody has opened goes to Trash too. Read mail
          // stays (someone looked at it for a reason), and so does a guest
          // message TATO has not stored yet.
          if (!where && purgeUnread && !message.flags?.has("\\Seen") && !(rule.group === "guest" && !isStored)) {
            where = "trash";
          }
          if (where && (isStored || oldEnough)) {
            if (where === "trash") toTrash.push(message.uid);
            else toArchive.push(message.uid);
          } else {
            result.kept += 1;
          }
        }
        if (toTrash.length > 0) {
          result.trashed += await moveInBatches(client, toTrash, trash);
        }
        if (toArchive.length > 0) {
          result.archived += await moveInBatches(client, toArchive, TURO_ARCHIVE_LABEL);
        }
      }
      const movedThisPass = result.trashed + result.archived - movedBefore;
      if (uids.length < SEARCH_RESULT_CAP || movedThisPass === 0 || Date.now() - startedAt >= CLEANUP_BUDGET_MS) break;
    }
    result.remaining = end;
  } finally {
    lock.release();
    await client.logout().catch(() => null);
  }
  return result;
}

/** A subject with the guest, car and numbers taken out, for grouping. */
function subjectPattern(subject: string) {
  return subject
    .replace(/^\([^)]*\)\s*[-–—]\s*/, "")
    .replace(/^(?:re|fwd?|fw)\s*:\s*/i, "Re: ")
    .replace(/^(Re: )?.+?(?=['’]s trip| has | is (?:booked|requesting|on)| wants | needs | left you| rated)/i, "$1{name}")
    .replace(/\byour (?!earnings|vehicle swap|account|trip|listing|car's)[A-Z][^,.!?]*?(?= (?:is|has|was|were|for)\b|[,.!?]|$)/, "your {car}")
    .replace(/\d[\d,.\-:/]*/g, "#")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90);
}

/**
 * What Turo mail is still sitting in the inbox, grouped by kind and
 * subject shape: the read-only survey before deciding which of it to
 * fold into notifications and clear. Envelopes only; nothing is moved.
 */
export async function censusMailbox(workspaceId: string, mailboxKey = "gmail") {
  const config = getMailboxes().find((box) => box.key === mailboxKey);
  if (!config) throw new GmailInboxError(`Mailbox ${mailboxKey} is not configured`, "GMAIL_NOT_CONFIGURED", 400);
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: true,
    auth: { user: config.user, pass: config.password },
    logger: false,
  });
  await client.connect();
  const stored = new Set(
    (await prisma.inboundEmail.findMany({ where: { workspaceId }, select: { messageId: true } })).map((row) => row.messageId),
  );
  const groups = new Map<
    string,
    { kind: string; pattern: string; count: number; inTato: number; oldest: string; newest: string; examples: string[]; senders: Set<string> }
  >();
  let total = 0;
  const lock = await client.getMailboxLock(config.mailbox);
  try {
    const since = new Date();
    since.setDate(since.getDate() - HISTORY_LOOKBACK_DAYS);
    const senderTerms = config.allowedSenders.map((sender) => ({ from: sender }));
    const uids = await client.search(
      { since, ...(senderTerms.length === 1 ? senderTerms[0] : { or: senderTerms }) },
      { uid: true },
    );
    for (let start = 0; start < (uids || []).length; start += 2000) {
      const window = (uids || []).slice(start, start + 2000);
      for await (const message of client.fetch(window, { uid: true, envelope: true }, { uid: true })) {
        const subject = message.envelope?.subject ?? "";
        const kind = classifyTuroSubject(subject)?.kind ?? "UNCLASSIFIED";
        const pattern = subjectPattern(subject);
        const key = `${kind}|${pattern}`;
        const date = (message.envelope?.date ?? new Date(0)).toISOString().slice(0, 10);
        const group =
          groups.get(key) ??
          { kind, pattern, count: 0, inTato: 0, oldest: date, newest: date, examples: [], senders: new Set<string>() };
        group.count += 1;
        if (message.envelope?.messageId && stored.has(message.envelope.messageId.trim())) group.inTato += 1;
        if (date < group.oldest) group.oldest = date;
        if (date > group.newest) group.newest = date;
        if (group.examples.length < 2 && !group.examples.includes(subject)) group.examples.push(subject.slice(0, 120));
        const from = message.envelope?.from?.[0]?.address?.toLowerCase();
        if (from) group.senders.add(from);
        groups.set(key, group);
        total += 1;
      }
    }
  } finally {
    lock.release();
    await client.logout().catch(() => null);
  }
  const list = [...groups.values()]
    .map((group) => ({ ...group, senders: [...group.senders].slice(0, 3) }))
    .sort((a, b) => b.count - a.count);
  const byKind: Record<string, number> = {};
  for (const group of list) byKind[group.kind] = (byKind[group.kind] ?? 0) + group.count;
  return { total, byKind, groups: list.slice(0, 80), groupCount: list.length };
}

/** New and cancelled Turo trips since `since`, as one notification. */
async function notifyBookingChanges(workspaceId: string, since: Date) {
  const select = {
    renterName: true,
    pickupDatetime: true,
    vehicle: { select: { brand: true, model: true, plateNumber: true } },
  } as const;
  const [created, cancelled] = await Promise.all([
    prisma.order.findMany({
      where: { workspaceId, createdAt: { gte: since }, isArchived: false, status: { not: "cancelled" } },
      select,
      orderBy: { pickupDatetime: "asc" },
      take: 10,
    }),
    prisma.order.findMany({
      where: { workspaceId, updatedAt: { gte: since }, createdAt: { lt: since }, status: "cancelled" },
      select,
      orderBy: { pickupDatetime: "asc" },
      take: 10,
    }),
  ]);
  if (created.length === 0 && cancelled.length === 0) return;
  const when = (date: Date) =>
    new Intl.DateTimeFormat("zh-CN", {
      timeZone: "America/Vancouver",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  const line = (order: (typeof created)[number]) =>
    `${order.renterName}${order.vehicle ? ` · ${order.vehicle.brand} ${order.vehicle.model} ${order.vehicle.plateNumber}` : ""} · ${when(order.pickupDatetime)}`;
  const title =
    created.length > 0 && cancelled.length > 0
      ? `${created.length} 个新预订，${cancelled.length} 个取消`
      : created.length > 0
        ? created.length === 1
          ? "新预订"
          : `${created.length} 个新预订`
        : cancelled.length === 1
          ? "预订已取消"
          : `${cancelled.length} 个预订取消`;
  const body = [...created.map((order) => `新 ${line(order)}`), ...cancelled.map((order) => `取消 ${line(order)}`)]
    .slice(0, 4)
    .join("\n");
  await notifyCategory(workspaceId, "bookings", { title, body, url: "/calendar", tag: "bookings" });
}

/**
 * Everything after the mailbox closes shares one deadline.
 *
 * Translation and enrichment each used to carry their own budget, and
 * the sum could exceed Railway's 300s gateway -- at which point the
 * request is killed and the whole sync is lost, new mail included.
 */
const POST_INGEST_BUDGET_MS = 210_000;

/**
 * Only the recent end of the archive gets a summary.
 *
 * 1,091 rows lack one and the feed shows 300. Chasing the rest spends
 * hours of model time on mail nobody will scroll to, and a queue that
 * never empties hides a queue that is growing -- the number stops
 * meaning anything.
 */
const ENRICH_SCOPE = 400;

/** Model calls per sync run. */
const ENRICH_MAX_MESSAGES = 12;

/**
 * Extractions in flight at once.
 *
 * Each call is ~45s of mostly waiting, so running them one at a time
 * wasted the budget: 4 messages per run could not keep up with a
 * mailbox that receives more than that in a quarter hour, and the
 * backlog would grow forever. Three at a time fits ~12 into the same
 * window. Kept deliberately low -- this is a background catch-up, not
 * a reason to collect a rate limit.
 */
const ENRICH_CONCURRENCY = 3;

/**
 * Wall-clock ceiling for the enrichment pass, in milliseconds.
 *
 * Railway's gateway cuts a request off at 300s, and losing the request
 * loses the whole sync. The budget is checked between chunks, so the
 * true worst case is this value plus one full per-call timeout:
 * 150 + 90 = 240s, plus ~5s of ingestion, leaving about a minute of
 * margin. Both bounds are needed -- a message count cannot cap
 * duration when one call may take 90s.
 */
const ENRICH_TIME_BUDGET_MS = 150_000;

/**
 * Fill in what the subject cannot give us: summaries, guest names,
 * reservation ids, and the order link.
 *
 * Split out of ingestion because the two have opposite cost profiles.
 * Reading the mailbox is fast and must finish; asking a reasoning
 * model about each message is slow and merely improves the result. The
 * first version did both in one loop, so a burst of new mail took the
 * request past the gateway timeout and lost the entire sync -- new
 * messages included. Now the mail always lands, classified, and the
 * summaries catch up over the next few runs.
 *
 * Newest first: a summary matters most for a message someone may still
 * need to answer.
 */
async function enrichPendingEmails(
  workspaceId: string,
  result: GmailSyncResult,
  deadline: number,
) {
  // The cutoff behind which mail is left in English: old enough that
  // nobody is scrolling to it, and counting it would make the backlog
  // number permanently alarming.
  const scoped = await prisma.inboundEmail.findMany({
    where: { workspaceId },
    orderBy: { receivedAt: "desc" },
    skip: ENRICH_SCOPE - 1,
    take: 1,
    select: { receivedAt: true },
  });
  const scopeFrom = scoped[0]?.receivedAt ?? new Date(0);

  const pending = await prisma.inboundEmail.findMany({
    where: {
      workspaceId,
      // Rows never extracted, and rows extracted before the Chinese
      // summary existed. Newest first, so the feed the operator is
      // actually looking at fills in before the archive does.
      OR: [{ parsedAt: null }, { summaryZh: null }],
      // Bounded to the recent end. See ENRICH_SCOPE.
      receivedAt: { gte: scopeFrom },
    },
    orderBy: { receivedAt: "desc" },
    select: { id: true, subject: true, fromName: true, bodyText: true, kind: true },
    take: ENRICH_MAX_MESSAGES,
  });

  const startedAt = Date.now();

  // Chunked rather than a queue: the batch is at most 12 and every
  // item costs about the same, so the tail-end idling a worker is
  // worth less than the simplicity. The budget is checked between
  // chunks, so one slow chunk can overrun by at most its own duration
  // -- bounded by the per-call timeout, which is why both limits exist.
  for (let index = 0; index < pending.length; index += ENRICH_CONCURRENCY) {
    if (Date.now() - startedAt > ENRICH_TIME_BUDGET_MS || Date.now() > deadline) break;

    const chunk = pending.slice(index, index + ENRICH_CONCURRENCY);

    await Promise.all(
      chunk.map(async (email) => {
        const outcome = await extractTuroEmail({
          subject: email.subject ?? "",
          fromName: email.fromName,
          bodyText: email.bodyText ?? "",
        });

        if (!outcome.ok) {
          result.parseFailed += 1;
          // Distinct reasons only, and a short list: this rides back in
          // the sync response, which the scheduled workflow prints on
          // every run. A silent parseFailed count says something is
          // wrong but not what, which is how the last three of these
          // took hours.
          if (!result.enrichErrors.includes(outcome.reason) && result.enrichErrors.length < 5) {
            result.enrichErrors.push(outcome.reason);
          }
          return;
        }

        const extracted = outcome.data;

        // Link to the order this email is about, when the extractor
        // found a reservation id we already know.
        let orderId: string | null = null;
        if (extracted.reservationId) {
          const order = await prisma.order.findFirst({
            where: { workspaceId, externalOrderId: extracted.reservationId.trim() },
            select: { id: true },
          });
          orderId = order?.id ?? null;
        }

        await prisma.inboundEmail.update({
          where: { id: email.id },
          data: {
            // The subject classifier already had its say at ingest.
            // Only let the model name the kind where the patterns
            // declined to.
            kind: email.kind === InboundEmailKind.OTHER ? extracted.kind : email.kind,
            parsed: JSON.stringify(extracted),
            parsedAt: new Date(),
            // The column is what marks a row done (see the query above),
            // so it has to be written here too. It was not: every run
            // re-extracted the same newest twelve, the backlog never
            // shrank, and older messages never got a summary. English
            // when the model gave no Chinese, so a row cannot stay
            // "pending" forever.
            summaryZh: (extracted.summaryZh || extracted.summary || email.subject || "").slice(0, 600) || null,
            orderId,
          },
        });

        result.parsed += 1;
      }),
    );
  }

  result.enrichRemaining = await prisma.inboundEmail.count({
    where: {
      workspaceId,
      OR: [{ parsedAt: null }, { summaryZh: null }],
      receivedAt: { gte: scopeFrom },
    },
  });

  if (result.enrichRemaining > 0) {
    // eslint-disable-next-line no-console
    console.log(`[gmail-sync] ${result.enrichRemaining} message(s) still awaiting a summary`);
  }
}

/**
 * Re-attribute stored messages.
 *
 * Rows imported while the model was failing all landed as OTHER, which
 * made the guest-message alert detector -- it selects on kind --
 * report an empty fleet while guests were waiting. Rows imported
 * before attribution existed carry no guest, vehicle, trip or link.
 * Both are healed here, using the same function the ingest path uses,
 * so history and new mail are never attributed by two different rules.
 *
 * No network and no model: this is string matching and indexed
 * queries, cheap enough to run on every sync.
 *
 * A row is touched only where it is still empty. `kind` is the one
 * exception -- OTHER is the "we did not know" value, so a subject that
 * now parses is allowed to replace it, while a kind already decided is
 * left alone.
 */
async function reclassifyBySubject(workspaceId: string, fleet: VehicleForMatch[]) {
  const stale = await prisma.inboundEmail.findMany({
    where: {
      workspaceId,
      OR: [
        { kind: InboundEmailKind.OTHER },
        { guestName: null },
        { turoLink: null },
        { orderId: null },
        { turoAccount: null },
        { guestText: null },
      ],
    },
    select: {
      id: true,
      subject: true,
      bodyText: true,
      receivedAt: true,
      kind: true,
      guestName: true,
      guestText: true,
      turoAccount: true,
      vehicleId: true,
      turoLink: true,
      orderId: true,
    },
    // Bounded so a mailbox with years of history cannot turn one sync
    // into a full-table rewrite. The rest heal on later runs.
    orderBy: { receivedAt: "desc" },
    take: 200,
  });

  let updated = 0;

  for (const email of stale) {
    const attribution = await attributeEmail({
      workspaceId,
      subject: email.subject ?? "",
      bodyText: email.bodyText ?? "",
      receivedAt: email.receivedAt,
      fleet,
      defaultAccount: email.turoAccount,
    });

    const data: {
      kind?: InboundEmailKind;
      guestName?: string;
      guestText?: string;
      turoAccount?: string;
      vehicleId?: string;
      turoLink?: string;
      orderId?: string;
    } = {};

    if (email.kind === InboundEmailKind.OTHER && attribution.kind !== InboundEmailKind.OTHER) {
      data.kind = attribution.kind;
    }
    if (!email.guestName && attribution.guestName) data.guestName = attribution.guestName;
    if (!email.turoAccount && attribution.turoAccount) data.turoAccount = attribution.turoAccount;
    // No need to touch any cached Chinese: a translation of the guest's
    // words lives in its own column, so a row gaining guestText simply
    // has nothing there yet and translates on next open.
    if (!email.guestText && attribution.guestText) data.guestText = attribution.guestText;
    if (!email.vehicleId && attribution.vehicleId) data.vehicleId = attribution.vehicleId;
    if (!email.turoLink && attribution.turoLink) data.turoLink = attribution.turoLink;
    if (!email.orderId && attribution.orderId) data.orderId = attribution.orderId;

    if (Object.keys(data).length === 0) continue;

    await prisma.inboundEmail.update({ where: { id: email.id }, data });
    updated += 1;
  }

  if (updated > 0) {
    // eslint-disable-next-line no-console
    console.log(`[gmail-sync] re-attributed ${updated} stored message(s)`);
  }

  return updated;
}

export function summarizeGmailSyncResult(result: GmailSyncResult) {
  return [
    `scanned=${result.scanned}`,
    `imported=${result.imported}`,
    `duplicate=${result.skippedDuplicate}`,
    `otherSender=${result.skippedSender}`,
    `parsed=${result.parsed}`,
    `parseFailed=${result.parseFailed}`,
    `reclassified=${result.reclassified}`,
    result.trashed ? `trashed=${result.trashed}` : "",
    result.archived ? `archived=${result.archived}` : "",
    result.historyRemaining != null ? `historyRemaining=${result.historyRemaining}` : "",
    result.diskUsedPercent != null ? `disk=${result.diskUsedPercent}%` : "",
    result.historyPaused ? `historyPaused=${result.historyPaused}` : "",
    `enrichRemaining=${result.enrichRemaining}`,
    result.enrichErrors.length > 0 ? `enrichErrors=${result.enrichErrors.join("|")}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}
