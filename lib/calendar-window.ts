/**
 * How the calendar cuts time into fetchable pieces.
 *
 * Shared by the page (which server-renders the first pieces so the
 * grid has bars on first paint) and by the grid itself (which fetches
 * the rest as you scroll toward them). Both must agree on where the
 * cuts fall, or the server's work is invisible to the client and
 * every visit re-fetches what it was already given.
 *
 * Fixed chunks rather than arbitrary intervals: a chunk is identified
 * by one integer, so "have I loaded this?" is a set lookup instead of
 * interval arithmetic, and two chunks can never half-overlap.
 */

export const DAY_IN_MS = 24 * 60 * 60 * 1000;

/** Days per chunk. Sixty is about two months of orders per request --
 *  small enough that the first one lands quickly, large enough that a
 *  hard sideways fling does not fire a dozen requests. */
export const CHUNK_DAYS = 60;

/** How far back and forward the scrollable canvas goes. Past is
 *  shorter on purpose: the calendar answers "what is out now and what
 *  is coming", and older trips are a lookup that /orders does better
 *  -- but they are now reachable here rather than absent. */
export const CANVAS_PAST_DAYS = 180;
export const CANVAS_FUTURE_DAYS = 400;

/** Chunks are loaded before they are reached, so the bars are already
 *  there when the dates scroll into view rather than appearing a
 *  beat later. */
export const PREFETCH_LEAD_DAYS = 45;

/** UTC day number since the epoch. The chunk grid has to be the same
 *  for everyone, so it is anchored in UTC rather than in whatever zone
 *  the viewer happens to be in. */
export function utcDayNumber(date: Date) {
  return Math.floor(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / DAY_IN_MS,
  );
}

export function chunkIndexForDate(date: Date) {
  return Math.floor(utcDayNumber(date) / CHUNK_DAYS);
}

/** The inclusive-start, exclusive-end day range a chunk covers. */
export function chunkRange(index: number) {
  const start = new Date(index * CHUNK_DAYS * DAY_IN_MS);
  const end = new Date((index + 1) * CHUNK_DAYS * DAY_IN_MS);
  return { start, end };
}

/** Every chunk index touching [from, to], inclusive of both ends. */
export function chunkIndexesForRange(from: Date, to: Date) {
  const first = chunkIndexForDate(from);
  const last = chunkIndexForDate(to);
  const indexes: number[] = [];
  for (let i = first; i <= last; i += 1) indexes.push(i);
  return indexes;
}

/** `YYYY-MM-DD` in UTC, which is what the fetch route parses. */
export function toDayParam(date: Date) {
  return date.toISOString().slice(0, 10);
}

/**
 * The chunks the server renders into the page.
 *
 * A month behind and three ahead: enough that the grid opens with
 * bars already drawn either side of today, and that an ordinary
 * week's scrolling needs no request at all.
 */
export function initialChunkIndexes(today: Date) {
  return chunkIndexesForRange(
    new Date(today.getTime() - 30 * DAY_IN_MS),
    new Date(today.getTime() + 90 * DAY_IN_MS),
  );
}

/** The date span covered by a set of chunk indexes. */
export function spanForChunks(indexes: number[]) {
  const sorted = [...indexes].sort((a, b) => a - b);
  return {
    from: chunkRange(sorted[0]).start,
    to: chunkRange(sorted[sorted.length - 1]).end,
  };
}
