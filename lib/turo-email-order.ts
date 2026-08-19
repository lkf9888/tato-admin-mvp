/**
 * Reading a trip out of a Turo notification.
 *
 * Turo has no API, but it does send a templated plain-text email for
 * every state change a booking goes through, and those emails carry
 * labelled fields: `Trip start:`, `Trip end:`, `You earn:`,
 * `Mileage included:`, `Reservation ID #`. Anchors like that are worth
 * more than a model — they are exact, they cost nothing, and they keep
 * working when the model is down or out of credit.
 *
 * WHAT THIS CAN AND CANNOT REPLACE
 *
 * Booking, change and cancellation mail is complete: reservation id,
 * both datetimes, the guest and their phone, the vehicle, the expected
 * earnings and the included distance. That is everything the calendar
 * and the operations side of this app need, and it arrives seconds
 * after the event rather than whenever somebody remembers to export.
 *
 * The trip-ended mail is not. Turo puts the settlement — `Total paid`,
 * `Distance included`, `Extras` — in an HTML table, and the plain-text
 * alternative keeps the labels and drops every value. So the money
 * that actually settles a trip still comes from the CSV, and the
 * `You earn:` figure here is what was expected at booking time, before
 * tolls, late fees, cleaning, damage or reimbursements moved it.
 *
 * Treat the two as different sources with different jobs: mail owns
 * the booking lifecycle, the CSV owns the ledger.
 */

export type TuroEmailIntent =
  | "created"
  | "changed"
  | "cancelled"
  | "ended"
  | "reminder";

export type TuroOrderFacts = {
  intent: TuroEmailIntent;
  reservationId: string;
  vehicleText: string | null;
  vehicleYear: number | null;
  guestName: string | null;
  guestPhone: string | null;
  tripStart: Date | null;
  tripEnd: Date | null;
  /** Expected earnings as quoted at this point in the trip's life. */
  earnings: number | null;
  mileageIncludedKm: number | null;
  location: string | null;
  conversationUrl: string | null;
  /** Who cancelled, when the subject says. Turo cancels differently
   *  from a guest, and a host cancelling is different again. */
  cancelledBy: "guest" | "host" | "turo" | null;
  /** Which Turo account the listing sits on -- read from the co-host
   *  prefix, normalised. Null is the main account. This is the only
   *  field in the feed that crosses the account boundary a CSV export
   *  cannot. */
  coHostAccount: string | null;
};

function normalize(text: string) {
  return text.replace(/[‘’ʼ]/g, "'").replace(/ /g, " ");
}

/** `Reservation ID #60515467` and `Reservation ID: #59314360` both occur. */
function matchReservationId(body: string, subject: string) {
  const fromBody = body.match(/Reservation ID:?\s*#\s*(\d{6,})/i);
  if (fromBody?.[1]) return fromBody[1];

  // Change mail puts it in the subject: "... (60478224)".
  const fromSubject = subject.match(/\((\d{6,})\)/);
  if (fromSubject?.[1]) return fromSubject[1];

  // Support mail spells it out: "Reservation - 60123362".
  const spelled = subject.match(/Reservation\s*-\s*(\d{6,})/i);
  if (spelled?.[1]) return spelled[1];

  // Last resort: the conversation link.
  const fromUrl = body.match(/turo\.com\/(?:us\/en\/)?reservation\/(\d{6,})/i);
  return fromUrl?.[1] ?? null;
}

const MONTHS = "january february march april may june july august september october november december".split(" ");

/**
 * `8/29/26 1:30 pm` — the compact form Turo uses in the detail block.
 *
 * Two-digit years are read as 2000+. Built as local time on purpose:
 * the container runs on America/Vancouver, which is the fleet's own
 * clock and the one these times are written in. Reading them as UTC
 * would shift every pickup by seven or eight hours.
 */
function parseCompactDateTime(value: string): Date | null {
  const m = value.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})\s*([ap])\.?m\.?/i);
  if (!m) return null;

  const [, mm, dd, yy, hh, min, ampm] = m;
  let year = Number(yy);
  if (year < 100) year += 2000;

  let hour = Number(hh) % 12;
  if (ampm.toLowerCase() === "p") hour += 12;

  const date = new Date(year, Number(mm) - 1, Number(dd), hour, Number(min), 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** `Saturday, August 29, 2026, 1:30 PM` — the prose form in the intro. */
function parseLongDateTime(value: string): Date | null {
  const m = value.match(
    /([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4}),?\s*(\d{1,2}):(\d{2})\s*([AP])\.?M\.?/i,
  );
  if (!m) return null;

  const monthIndex = MONTHS.indexOf(m[1].toLowerCase());
  if (monthIndex < 0) return null;

  let hour = Number(m[4]) % 12;
  if (m[6].toUpperCase() === "P") hour += 12;

  const date = new Date(Number(m[3]), monthIndex, Number(m[2]), hour, Number(m[5]), 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseMoney(value: string | undefined): number | null {
  if (!value) return null;
  const cleaned = value.replace(/[^\d.]/g, "");
  if (!cleaned) return null;
  const amount = Number.parseFloat(cleaned);
  return Number.isFinite(amount) ? amount : null;
}

/** "(Kevin's vehicle) - ..." -> { account: "kevin", rest: "..." } */
function splitCoHost(subject: string) {
  const match = subject.match(/^\(([^)]*)\)\s*[-–—]\s*/);
  if (!match) return { account: null as string | null, rest: subject };
  const account = match[1].replace(/'s\s+vehicles?$/i, "").trim().toLowerCase();
  return { account: account || null, rest: subject.slice(match[0].length) };
}

function detectIntent(subject: string): TuroEmailIntent | null {
  const s = normalize(subject).toLowerCase();
  if (/is booked/.test(s)) return "created";
  if (/cancell?ed/.test(s)) return "cancelled";
  if (/has changed their trip|confirmed .*change request/.test(s)) return "changed";
  if (/has returned your/.test(s)) return "ended";
  if (/has an upcoming trip/.test(s)) return "reminder";
  return null;
}

function detectCanceller(subject: string): "guest" | "host" | "turo" | null {
  const s = normalize(subject).toLowerCase();
  if (!/cancell?ed/.test(s)) return null;
  if (/^turo has cancell?ed/.test(s)) return "turo";
  if (/^you've cancell?ed/.test(s)) return "host";
  return "guest";
}

/**
 * Everything a trip email states about its trip, or null when the mail
 * is not about one.
 *
 * Returns null rather than a half-filled object when there is no
 * reservation id: without it there is nothing to attach the facts to,
 * and guessing which trip they belong to is how a change lands on the
 * wrong booking.
 */
export function parseTuroOrderEmail(input: {
  subject: string;
  bodyText: string;
}): TuroOrderFacts | null {
  const raw = normalize(input.subject ?? "");
  const { account: coHostAccount, rest: subject } = splitCoHost(raw);
  const body = normalize(input.bodyText ?? "");

  const intent = detectIntent(subject);
  if (!intent) return null;

  const reservationId = matchReservationId(body, subject);
  if (!reservationId) return null;

  const startRaw = body.match(/Trip start:\s*([^\n]+)/i)?.[1] ?? "";
  const endRaw = body.match(/Trip end:\s*([^\n]+)/i)?.[1] ?? "";

  let tripStart = parseCompactDateTime(startRaw);
  let tripEnd = parseCompactDateTime(endRaw);

  // The booking mail also states both times in prose, which survives
  // when the detail block does not.
  if (!tripStart || !tripEnd) {
    const prose = body.match(/is booked from ([^.]+?) to ([^.]+?)\./i);
    tripStart = tripStart ?? (prose?.[1] ? parseLongDateTime(prose[1]) : null);
    tripEnd = tripEnd ?? (prose?.[2] ? parseLongDateTime(prose[2]) : null);
  }

  // "Lexus NX 2019" on its own line, above `booked by` / `requested by`.
  const vehicleLine = body.match(/\n\s*([A-Z][\w'’&.\- ]{2,60}?\s+(19|20)\d{2})\s*\n\s*\n?\s*(?:booked|requested) by/i);
  const vehicleText = vehicleLine?.[1]?.trim() ?? null;
  const vehicleYear = vehicleText ? Number(vehicleText.match(/(19|20)\d{2}$/)?.[0] ?? "") || null : null;

  const guestName =
    body.match(/(?:booked|requested) by\s+([^\n]+)/i)?.[1]?.trim() ||
    subject.match(/^(?:\([^)]*\)\s*-\s*)?(.+?)(?:'s)? (?:has |trip )/i)?.[1]?.trim() ||
    null;

  const guestPhone = body.match(/\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/)?.[0]?.trim() ?? null;

  const earnings = parseMoney(body.match(/You(?:'ll)? earn:?\s*(?:CA)?\$?\s*([\d,]+\.?\d*)/i)?.[1]);
  const mileage = body.match(/Mileage included:\s*([\d,]+)\s*km/i)?.[1];
  const location = body.match(/with your .+? at ([^.]+?) is booked/i)?.[1]?.trim() ?? null;

  const conversationUrl =
    body.match(/https:\/\/turo\.com\/(?:us\/en\/)?reservation\/\d+(?:\/messages)?/i)?.[0] ?? null;

  return {
    intent,
    reservationId,
    vehicleText,
    vehicleYear,
    guestName,
    guestPhone,
    tripStart,
    tripEnd,
    earnings,
    mileageIncludedKm: mileage ? Number(mileage.replace(/,/g, "")) : null,
    location,
    conversationUrl,
    cancelledBy: detectCanceller(subject),
    coHostAccount,
  };
}
