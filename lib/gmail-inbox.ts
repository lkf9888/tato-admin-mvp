import "server-only";

import { InboundEmailKind } from "@prisma/client";
import { ImapFlow } from "imapflow";
import { simpleParser, type ParsedMail } from "mailparser";

import { kimiExtractJson, isKimiConfigured } from "@/lib/kimi";
import { prisma } from "@/lib/prisma";
import { classifyTuroSubject } from "@/lib/turo-subjects";

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

export function isGmailInboxConfigured() {
  const config = getGmailConfig();
  return Boolean(config.user && config.password);
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
  "needsAction": true if the host must reply or act, false otherwise
}

Rules:
- Use null for anything the email does not state. Never guess a value.
- "needsAction" is true for guest messages awaiting a reply, and for
  anything asking the host to confirm, approve, or provide something.
  It is false for pure notifications like payout confirmations.
- Write "summary" in the same language as the email.`;

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
  /** Messages still waiting for a summary after this run's budget ran
   *  out. Drains over subsequent runs; non-zero is normal after a
   *  burst, persistently large means the schedule is too slow. */
  enrichRemaining: number;
  /** Distinct reasons extraction failed this run, verbatim from the
   *  model client. Empty is the healthy state. */
  enrichErrors: string[];
};

/**
 * Pull recent Turo mail into `InboundEmail`.
 *
 * Idempotent: dedupes on (workspaceId, Message-ID), so overlapping runs
 * and IMAP replays are harmless. Safe to schedule as often as the
 * operator wants fresh data.
 */
export async function runGmailSync(input: { workspaceId: string }): Promise<GmailSyncResult> {
  const config = getGmailConfig();
  if (!config.user || !config.password) {
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

  // Heal history before fetching anything new. Rows imported while the
  // model was failing all landed as OTHER, which made the guest-message
  // alert detector -- it selects on kind -- report an empty fleet while
  // guests were waiting. The classifier needs no network and no model,
  // so this is a cheap pass that runs even when there is no new mail.
  result.reclassified = await reclassifyBySubject(input.workspaceId);

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

  const lock = await client.getMailboxLock(config.mailbox);
  try {
    const since = new Date();
    since.setDate(since.getDate() - getLookbackDays());

    const uids = await client.search({ since }, { uid: true });
    if (!uids || uids.length === 0) {
      return result;
    }

    // Newest first, capped — a first run against a busy mailbox should
    // not try to ingest years of history in one request.
    const selected = uids.slice(-getMaxMessages());
    result.scanned = selected.length;

    // Pre-load the message ids we already have so the common case (a
    // poll that finds nothing new) costs one query rather than one per
    // message.
    const existing = await prisma.inboundEmail.findMany({
      where: { workspaceId: input.workspaceId },
      select: { messageId: true },
      orderBy: { receivedAt: "desc" },
      take: 500,
    });
    const seen = new Set(existing.map((row) => row.messageId));

    for await (const message of client.fetch(
      selected,
      { uid: true, envelope: true, source: true },
      { uid: true },
    )) {
      const envelope = message.envelope;
      const messageId = envelope?.messageId?.trim();
      if (!messageId) continue;

      if (seen.has(messageId)) {
        result.skippedDuplicate += 1;
        continue;
      }

      const fromAddress = envelope?.from?.[0]?.address?.trim().toLowerCase() ?? "";
      if (!senderAllowed(fromAddress, config.allowedSenders)) {
        result.skippedSender += 1;
        continue;
      }

      // `source` is only present because we asked for it in the fetch
      // options, but the type is optional — skip rather than assert, so
      // a server that declines to return it degrades to "no new mail"
      // instead of throwing mid-loop.
      if (!message.source) continue;

      const parsedMail: ParsedMail = await simpleParser(message.source);
      const bodyText = condenseBody(parsedMail.text ?? "");
      const subject = (envelope?.subject ?? parsedMail.subject ?? "").slice(0, 500);
      const fromName = envelope?.from?.[0]?.name?.trim() || null;
      const receivedAt = envelope?.date ?? parsedMail.date ?? new Date();

      // No model call on this path. Classification comes from the
      // subject, which is exact for Turo's templates and costs
      // nothing; summaries and reservation ids are filled in by the
      // bounded enrichment pass after the mailbox is drained. Calling
      // the model here is what made this endpoint exceed the 300s
      // gateway timeout and fail the whole sync.
      const bySubject = classifyTuroSubject(subject);

      await prisma.inboundEmail.create({
        data: {
          workspaceId: input.workspaceId,
          messageId,
          fromAddress,
          fromName,
          subject,
          receivedAt,
          bodyText,
          kind: bySubject?.kind ?? InboundEmailKind.OTHER,
          parsedAt: null,
          parsed: null,
          orderId: null,
        },
      });

      seen.add(messageId);
      result.imported += 1;
    }
  } finally {
    lock.release();
    await client.logout().catch(() => null);
  }

  // Enrich after the mailbox is closed: these are slow model calls and
  // there is no reason to hold an IMAP connection open through them.
  await enrichPendingEmails(input.workspaceId, result);

  return result;
}

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
async function enrichPendingEmails(workspaceId: string, result: GmailSyncResult) {
  const pending = await prisma.inboundEmail.findMany({
    where: { workspaceId, parsedAt: null },
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
    if (Date.now() - startedAt > ENRICH_TIME_BUDGET_MS) break;

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
            orderId,
          },
        });

        result.parsed += 1;
      }),
    );
  }

  result.enrichRemaining = await prisma.inboundEmail.count({
    where: { workspaceId, parsedAt: null },
  });

  if (result.enrichRemaining > 0) {
    // eslint-disable-next-line no-console
    console.log(`[gmail-sync] ${result.enrichRemaining} message(s) still awaiting a summary`);
  }
}

/**
 * Re-classify stored messages the model left as OTHER.
 *
 * Only touches rows whose subject the classifier recognises, and only
 * rows currently sitting in OTHER -- a kind the model or an earlier
 * pass already decided is left alone. `parsed` is deliberately not
 * written: the extractor's structured fields (reservation id, guest
 * name, summary) are still missing, and the alert detector treats a
 * null `parsed` as "surface it" rather than "ignore it", which is the
 * safe side for a message that may need a reply.
 */
async function reclassifyBySubject(workspaceId: string) {
  const stale = await prisma.inboundEmail.findMany({
    where: { workspaceId, kind: InboundEmailKind.OTHER },
    select: { id: true, subject: true },
  });

  let updated = 0;

  for (const email of stale) {
    const match = classifyTuroSubject(email.subject ?? "");
    if (!match || match.kind === InboundEmailKind.OTHER) continue;

    await prisma.inboundEmail.update({
      where: { id: email.id },
      data: { kind: match.kind },
    });
    updated += 1;
  }

  if (updated > 0) {
    // eslint-disable-next-line no-console
    console.log(`[gmail-sync] reclassified ${updated} stored message(s) by subject`);
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
    `enrichRemaining=${result.enrichRemaining}`,
    result.enrichErrors.length > 0 ? `enrichErrors=${result.enrichErrors.join("|")}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}
