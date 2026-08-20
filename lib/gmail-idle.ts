import "server-only";

import { ImapFlow } from "imapflow";

import { getGmailConfig, isGmailInboxConfigured, runGmailSync } from "@/lib/gmail-inbox";
import { resolveTuroSyncWorkspace } from "@/lib/turo-sync";

/**
 * Gmail push, instead of polling on somebody else's schedule.
 *
 * The scheduled job says every fifteen minutes. Measured against the
 * last six runs, GitHub actually delivered 31, 39, 41, 32 and 57
 * minutes -- their scheduler defers under load and documents that it
 * will. Lowering the cron to five would change a number nobody is
 * honouring.
 *
 * IMAP has a better mechanism. IDLE holds a connection open and the
 * server speaks when mail arrives, so the delay is however long Gmail
 * takes to tell us -- seconds. This container runs continuously with a
 * single replica, which is exactly the shape IDLE needs and the shape
 * a cron job was working around.
 *
 * The scheduled job stays. This is the fast path, not the only path:
 * if the connection dies quietly at 3am, the fifteen-minute job still
 * runs, and ingestion dedupes on Message-ID so both firing costs
 * nothing but a wasted query.
 */

/** Gmail drops an idle connection at 30 minutes. Renew before that;
 *  RFC 2177 recommends 29 and Gmail is not generous about it. */
const RENEW_MS = 24 * 60 * 1000;

/** After a new-mail signal, wait before reading. Turo often sends two
 *  notifications a second apart, and one fetch that catches both beats
 *  two fetches racing each other. */
const SETTLE_MS = 4_000;

/** Reconnect backoff. Starts patient, gives up on being clever after a
 *  few minutes -- a mailbox that has been unreachable for an hour is a
 *  configuration problem, not a blip, and hammering it will not help. */
const BACKOFF_MS = [5_000, 15_000, 60_000, 180_000, 300_000];

let started = false;
let syncing = false;

/**
 * What the watcher is doing, for /api/assistant/diagnose.
 *
 * A push connection fails silently by construction: when it stops
 * delivering, what you observe is mail not arriving, which is
 * indistinguishable from no mail having been sent. The cron job
 * underneath would keep the data correct and keep the failure
 * invisible -- so the state is reported rather than inferred.
 */
const status = {
  watching: false,
  connectedAt: null as string | null,
  lastEventAt: null as string | null,
  lastImportAt: null as string | null,
  reconnects: 0,
  lastError: null as string | null,
};

export function gmailIdleStatus() {
  return {
    ...status,
    // Absent when the process has never tried, which is a different
    // thing from tried and failed.
    enabled: started,
  };
}

async function ingestNow(reason: string) {
  // One at a time. IDLE can fire again while a sync is running, and
  // two concurrent IMAP fetches against the same mailbox produce
  // duplicate work and contend for the SQLite writer.
  if (syncing) return;
  syncing = true;
  try {
    const workspace = await resolveTuroSyncWorkspace();
    const result = await runGmailSync({ workspaceId: workspace.id, mode: "ingest" });
    if (result.imported > 0) {
      status.lastImportAt = new Date().toISOString();
      // eslint-disable-next-line no-console
      console.log(`[gmail-idle] ${reason} :: imported=${result.imported}`);
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(
      `[gmail-idle] sync failed :: ${error instanceof Error ? error.message : "unknown"}`,
    );
  } finally {
    syncing = false;
  }
}

export function startGmailIdle() {
  if (started) return;
  if (!isGmailInboxConfigured()) return;
  started = true;

  void (async () => {
    let attempt = 0;

    // Deliberately forever. Every exit path from the inner try leads
    // back here, because the failure this must survive is not an error
    // it can name -- it is a connection that stops delivering without
    // saying so.
    for (;;) {
      const config = getGmailConfig();
      let client: ImapFlow | null = null;

      try {
        client = new ImapFlow({
          host: config.host,
          port: config.port,
          secure: true,
          auth: { user: config.user, pass: config.password },
          logger: false,
        });

        await client.connect();
        await client.mailboxOpen(config.mailbox);
        attempt = 0;
        status.watching = true;
        status.connectedAt = new Date().toISOString();
        status.lastError = null;
        // eslint-disable-next-line no-console
        console.log("[gmail-idle] watching");

        // Catch up on anything that arrived while we were away.
        await ingestNow("reconnect");

        let settleTimer: NodeJS.Timeout | null = null;
        client.on("exists", () => {
          status.lastEventAt = new Date().toISOString();
          if (settleTimer) clearTimeout(settleTimer);
          settleTimer = setTimeout(() => void ingestNow("new mail"), SETTLE_MS);
        });

        // `idle()` resolves when the connection ends. Racing it against
        // a timer is what turns "hold until it breaks" into "hold, then
        // deliberately renew before Gmail decides for us".
        await Promise.race([
          client.idle(),
          new Promise((resolve) => setTimeout(resolve, RENEW_MS)),
        ]);

        if (settleTimer) clearTimeout(settleTimer);
      } catch (error) {
        status.watching = false;
        status.lastError = error instanceof Error ? error.message : "connection lost";
        status.reconnects += 1;
        // eslint-disable-next-line no-console
        console.error(`[gmail-idle] ${status.lastError}`);
        const wait = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
        attempt += 1;
        await new Promise((resolve) => setTimeout(resolve, wait));
      } finally {
        status.watching = false;
        await client?.logout().catch(() => null);
      }
    }
  })();
}
