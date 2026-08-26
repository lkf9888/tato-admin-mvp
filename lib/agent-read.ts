import "server-only";

/**
 * Shared shapes for the read API.
 *
 * Every list endpoint answers the same way -- `{ data, nextCursor }`
 * -- because the caller is a language model as often as it is a
 * script, and a model that has learned one endpoint's response should
 * not have to relearn the next one's. Cursor rather than page number
 * for the same reason a human list uses one: rows arrive while you are
 * reading, and offsets silently skip or repeat when they do.
 *
 * There is no rate limiting here, and that is a decision rather than
 * an omission. The credential is the control: tokens are per-machine,
 * individually revocable, and read-only. What a runaway loop can
 * actually cost is bounded instead by `MAX_PAGE_SIZE`, which caps the
 * work any single request can ask the database for -- the table this
 * app rate-limits against records *failed* attempts, and turning it
 * into a per-request counter would mean a write on every read.
 */

/** Cap on rows per request. A runaway agent can still loop, but each
 *  turn of the loop costs a bounded query rather than the whole table. */
export const MAX_PAGE_SIZE = 200;
export const DEFAULT_PAGE_SIZE = 50;

export function parseLimit(raw: string | null): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed)) return DEFAULT_PAGE_SIZE;
  return Math.min(Math.max(parsed, 1), MAX_PAGE_SIZE);
}

/** A query-string date, or null. Rejects nonsense rather than
 *  silently treating it as the epoch. */
export function parseDate(raw: string | null): Date | null {
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Money, to the cent. Float sums leave residue that reads as a bug
 *  in someone else's JSON. */
export function money(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
}

export function iso(date: Date | null | undefined): string | null {
  return date ? date.toISOString() : null;
}

/**
 * Cursor pagination arguments for Prisma.
 *
 * `skip: 1` because Prisma's cursor is inclusive -- without it every
 * page repeats the row the previous page ended on.
 */
export function cursorArgs(cursor: string | null): {
  cursor?: { id: string };
  skip?: number;
} {
  // Annotated rather than inferred: without it the two branches infer
  // as a union with and without the keys, and spreading that union
  // into a Prisma argument fails to typecheck at every call site.
  return cursor ? { cursor: { id: cursor }, skip: 1 } : {};
}

/**
 * Trim an over-fetched page down and report where the next one starts.
 *
 * Endpoints ask for `limit + 1` rows: getting one more back than was
 * asked for is what proves another page exists, without a second
 * count query that would have to be kept consistent with the first.
 */
export function paginate<T extends { id: string }>(rows: T[], limit: number) {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  return { data, nextCursor: hasMore ? (data[data.length - 1]?.id ?? null) : null };
}
