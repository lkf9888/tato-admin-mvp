/**
 * iCalendar (RFC 5545) output for the fleet calendar.
 *
 * Written by hand rather than pulled in as a dependency: the whole
 * format we need is VEVENT with six properties, and the parts that
 * actually go wrong -- CRLF, folding, escaping -- are the parts a
 * library would hide while still being our problem when Apple
 * Calendar silently refuses the feed.
 */

export type IcalEvent = {
  /** Stable across regenerations. Calendar clients key updates off it,
   *  so a changing uid turns every refresh into "everything is new". */
  uid: string;
  start: Date;
  /** Exclusive, as iCalendar's DTEND is. */
  end: Date;
  summary: string;
  description?: string;
  location?: string;
  cancelled?: boolean;
  updatedAt?: Date;
};

/** `YYYYMMDDTHHMMSSZ`. Everything is emitted in UTC so no VTIMEZONE
 *  block is needed and no client has to guess. */
function toIcalUtc(date: Date) {
  return `${date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`;
}

/**
 * Escape a TEXT value.
 *
 * Order matters: backslashes first, or the backslashes introduced
 * while escaping commas get escaped again and the value arrives
 * doubled.
 */
function escapeText(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/**
 * Fold to 75 octets, continuing with a leading space.
 *
 * Counted in octets, not characters: the limit is bytes, and a
 * Chinese renter name is three bytes per character. Folding by
 * character length would emit lines well over the limit, which strict
 * parsers reject. Split points are kept off the middle of a
 * multi-byte character.
 */
function foldLine(line: string) {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;

  const out: string[] = [];
  let current = "";
  let currentBytes = 0;
  // First line gets 75 octets; continuations lose one to the leading
  // space that marks them.
  let limit = 75;

  for (const char of line) {
    const size = encoder.encode(char).length;
    if (currentBytes + size > limit) {
      out.push(current);
      current = "";
      currentBytes = 0;
      limit = 74;
    }
    current += char;
    currentBytes += size;
  }
  if (current) out.push(current);

  return out.join("\r\n ");
}

function property(name: string, value: string) {
  return foldLine(`${name}:${value}`);
}

export function buildIcalendar({
  name,
  events,
  now = new Date(),
}: {
  name: string;
  events: IcalEvent[];
  now?: Date;
}) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//TATO//Fleet Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    property("X-WR-CALNAME", escapeText(name)),
    // Asks clients not to hammer the feed. A polite request, not a
    // guarantee -- most honour it, some ignore it.
    "X-PUBLISHED-TTL:PT1H",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
  ];

  for (const event of events) {
    lines.push(
      "BEGIN:VEVENT",
      property("UID", event.uid),
      property("DTSTAMP", toIcalUtc(event.updatedAt ?? now)),
      property("DTSTART", toIcalUtc(event.start)),
      property("DTEND", toIcalUtc(event.end)),
      property("SUMMARY", escapeText(event.summary)),
    );
    if (event.description) {
      lines.push(property("DESCRIPTION", escapeText(event.description)));
    }
    if (event.location) {
      lines.push(property("LOCATION", escapeText(event.location)));
    }
    // A cancelled trip is published as cancelled rather than dropped,
    // so a client that already has it removes it instead of keeping a
    // booking that is no longer happening.
    lines.push(property("STATUS", event.cancelled ? "CANCELLED" : "CONFIRMED"));
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");

  // CRLF throughout, and a trailing one: RFC 5545 is explicit about it
  // and the stricter parsers enforce it.
  return `${lines.join("\r\n")}\r\n`;
}
