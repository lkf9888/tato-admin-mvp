import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
  // eslint-disable-next-line no-var
  var prismaPragmasApplied: boolean | undefined;
}

export const prisma =
  global.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  global.prisma = prisma;
}

/**
 * SQLite settings this app cannot run correctly without.
 *
 * `journal_mode=WAL` — without it SQLite uses a rollback journal, where
 * a writer takes an exclusive lock on the whole database and every
 * reader waits. This app bulk-writes during CSV imports and during the
 * Gmail sync's enrichment pass, so "a writer is busy" is not a rare
 * state: it is several minutes of every hour, and during it an
 * ordinary page load can block until it gives up with SQLITE_BUSY and
 * returns a 500. WAL lets readers carry on against the last committed
 * snapshot while a write is in flight.
 *
 * `busy_timeout` — when a lock genuinely is contended, wait rather
 * than fail immediately. Five seconds is far longer than any statement
 * here needs and far shorter than a user will wait before reloading.
 *
 * `synchronous=NORMAL` — the WAL default and the right trade on a
 * Railway volume: durable across process crashes, which is what
 * actually happens, at a fraction of FULL's fsync cost. FULL only adds
 * protection against losing the machine mid-write, and the pre-deploy
 * snapshot in the entrypoint covers that case better.
 *
 * WAL is a persistent property of the file, so re-applying it is
 * harmless; busy_timeout is per-connection and has to be set here.
 * Failures are logged and swallowed: a Postgres URL, or a read-only
 * file, must not stop the app from booting when the query layer itself
 * is fine.
 *
 * ⚠️ `$queryRawUnsafe`, not `$executeRawUnsafe`, and each statement in
 * its own try.
 *
 * `PRAGMA journal_mode = WAL` returns a row -- the resulting mode --
 * and `$executeRawUnsafe` refuses any statement that returns results.
 * It was written with it, so it threw on every boot, one shared `try`
 * swallowed the throw, and the two statements after it never ran. The
 * log line said "SQLite pragmas not applied", which read like the
 * Postgres path described above rather than a bug.
 *
 * Measured, because the obvious reading of that is wrong twice over:
 *
 *   - WAL was applied anyway. SQLite runs the pragma and Prisma throws
 *     afterwards on the row it got back, so the side effect lands. On
 *     a fresh database `journal_mode` still went `delete` -> `wal`.
 *   - `busy_timeout` was already 5000 without us. Prisma sets its own
 *     on SQLite connections, so the statement we never reached was
 *     asking for what was already true.
 *
 * What the bug actually cost was `synchronous`, which stayed at FULL
 * instead of dropping to NORMAL -- an fsync on every write we did not
 * need, not a correctness or availability problem. Worth fixing, worth
 * not overstating.
 */
async function applySqlitePragmas() {
  if (global.prismaPragmasApplied) return;
  global.prismaPragmasApplied = true;

  const url = process.env.DATABASE_URL ?? "";
  if (!url.startsWith("file:")) return;

  for (const statement of [
    "PRAGMA journal_mode = WAL;",
    "PRAGMA busy_timeout = 5000;",
    "PRAGMA synchronous = NORMAL;",
  ]) {
    try {
      await prisma.$queryRawUnsafe(statement);
    } catch (error) {
      // One failure must not skip the rest. They are independent
      // settings, and the one that fails is rarely the one that
      // matters most.
      // eslint-disable-next-line no-console
      console.error(
        `[prisma] SQLite pragma not applied (${statement}) :: ${
          error instanceof Error ? error.message : "unknown"
        }`,
      );
    }
  }
}

void applySqlitePragmas();
