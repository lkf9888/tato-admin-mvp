import { z } from "zod";

import { zonedDateTimeToUtc } from "@/lib/booking-time";

const LOCAL_DATETIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?$/;

/**
 * A time as an agent sends it, as the instant it is.
 *
 * Preferably without an offset -- "2026-10-15T10:00:00" -- read on the
 * fleet's clock. That is what a Turo page shows, and leaving the offset
 * to us is the point: an agent that appends one has to know Vancouver is
 * -07:00 until November and -08:00 after, and one that appends "Z" to a
 * time it never converted moves everything seven hours. With an explicit
 * offset or Z, the string is taken at its word. Seconds in a local time
 * are dropped: the page shows minutes.
 *
 * Shared by every agent route that takes a time, so they read one the
 * same way.
 */
export function parseAgentTime(value: string): Date | null {
  const local = LOCAL_DATETIME.exec(value);
  if (local) return zonedDateTimeToUtc(local[1], local[2]);
  if (!z.string().datetime({ offset: true }).safeParse(value).success) return null;
  return new Date(value);
}

/** A zod field for an agent-supplied time; parse with `parseAgentTime`. */
export const agentTimeSchema = z
  .string()
  .trim()
  .refine((value) => parseAgentTime(value) !== null, {
    message: "Use 2026-10-15T10:00:00 (Vancouver local time), or ISO 8601 with an offset",
  });

/** How the catalogue tells an agent to send a time. */
export const AGENT_TIME_FORMAT =
  "the time as the page shows it, WITHOUT an offset: 2026-10-15T10:00:00 is read as Vancouver local time. Do not append Z unless you actually converted to UTC.";
