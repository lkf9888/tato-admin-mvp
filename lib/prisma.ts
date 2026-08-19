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
 */
async function applySqlitePragmas() {
  if (global.prismaPragmasApplied) return;
  global.prismaPragmasApplied = true;

  const url = process.env.DATABASE_URL ?? "";
  if (!url.startsWith("file:")) return;

  try {
    await prisma.$executeRawUnsafe("PRAGMA journal_mode = WAL;");
    await prisma.$executeRawUnsafe("PRAGMA busy_timeout = 5000;");
    await prisma.$executeRawUnsafe("PRAGMA synchronous = NORMAL;");
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(
      `[prisma] SQLite pragmas not applied :: ${error instanceof Error ? error.message : "unknown"}`,
    );
  }
}

void applySqlitePragmas();
