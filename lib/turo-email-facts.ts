/**
 * The facts a Turo notification states, read off its plain-text body.
 *
 * Turo's mails share one template: a sentence about what happened, then
 * a "Booked trip" block -- car, trip start and end, earnings, distance,
 * reservation id, location, the guest and their phone. A change shows
 * the new value and then the old one on the same line ("Trip end
 * 2026-10-21 7:00 a.m. 2026-10-21 11:00 a.m."), and a request to the
 * host says how long they have ("You have until ... to respond").
 *
 * Pure string work, so the updates page can show these for every mail
 * TATO holds, including the years of history ingested before the model
 * extraction existed. Anything the body does not state is left out
 * rather than guessed.
 */

import { zonedDateTimeToUtc } from "@/lib/booking-time";

export type TuroEmailFacts = {
  reservationId?: string;
  tripStart?: string;
  tripStartWas?: string;
  tripEnd?: string;
  tripEndWas?: string;
  /** What the host earns, as Turo printed it ("$72.47"). */
  earnings?: string;
  earningsWas?: string;
  /** What the guest paid, on return and invoice mail. */
  amount?: string;
  location?: string;
  guestPhone?: string;
  distance?: string;
  /** What the guest wrote with a trip change ("we might be early to go
   *  to the airport"), which Turo appends to the last listed change. */
  guestNote?: string;
  /** The reply-by line of a request, as Turo wrote it. */
  respondBy?: string;
  /** The same instant, when it could be read as a date. */
  respondByAt?: string;
};

const DATETIME = String.raw`\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}\s*[ap]\.?m\.?`;
const MONEY = String.raw`\$[\d,]+(?:\.\d{2})?`;

function flat(body: string) {
  return body.replace(/\s+/g, " ").trim();
}

/** "2026-10-21 7:00 a.m." → "10/21 7:00 am". */
export function shortTuroDateTime(value: string) {
  const match = value.match(/\d{4}-(\d{2})-(\d{2})\s+(\d{1,2}:\d{2})\s*([ap])/i);
  if (!match) return value;
  return `${Number(match[1])}/${Number(match[2])} ${match[3]} ${match[4].toLowerCase()}m`;
}

function pair(text: string, label: string, token: string) {
  const match = text.match(new RegExp(`${label}\\s+(${token})(?:\\s+(${token}))?`, "i"));
  if (!match) return {};
  return { now: match[1], was: match[2] };
}

/** "Wednesday, October 21, 2026, 11:48 a.m." as an instant, on the
 *  fleet's clock, which is the one Turo writes these in. */
function parseRespondBy(value: string) {
  const match = value.match(/([A-Z][a-z]+)\s+(\d{1,2}),\s*(\d{4}),?\s+(\d{1,2}):(\d{2})\s*([ap])/);
  if (!match) return undefined;
  const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  const month = months.indexOf(match[1].toLowerCase());
  if (month < 0) return undefined;
  let hour = Number(match[4]) % 12;
  if (match[6].toLowerCase() === "p") hour += 12;
  const pad = (value: number) => String(value).padStart(2, "0");
  const date = `${match[3]}-${pad(month + 1)}-${pad(Number(match[2]))}`;
  return zonedDateTimeToUtc(date, `${pad(hour)}:${match[5]}`)?.toISOString();
}

export function readTuroEmailFacts(body: string): TuroEmailFacts {
  const text = flat(body);
  const facts: TuroEmailFacts = {};

  const reservation = text.match(/Reservation ID:?\s*#?\s*(\d{6,})/i) ?? text.match(/\((\d{7,})\)/);
  if (reservation) facts.reservationId = reservation[1];

  const start = pair(text, "Trip start", DATETIME);
  if (start.now) facts.tripStart = start.now;
  if (start.was && start.was !== start.now) facts.tripStartWas = start.was;
  const end = pair(text, "Trip end", DATETIME);
  if (end.now) facts.tripEnd = end.now;
  if (end.was && end.was !== end.now) facts.tripEndWas = end.was;
  // Return mail has its own shape: "Start 2026-10-17 1:30 p.m. End ...".
  if (!facts.tripStart) {
    const returned = text.match(new RegExp(`\\bStart\\s+(${DATETIME})\\s+End\\s+(${DATETIME})`, "i"));
    if (returned) {
      facts.tripStart = returned[1];
      facts.tripEnd = returned[2];
    }
  }

  const earn = pair(text, "You earn", MONEY);
  if (earn.now) facts.earnings = earn.now;
  if (earn.was && earn.was !== earn.now) facts.earningsWas = earn.was;
  if (!facts.earnings) {
    const willEarn = text.match(new RegExp(`You(?:’|')ll earn\\s+(${MONEY})`, "i"));
    if (willEarn) facts.earnings = willEarn[1];
  }
  const paid = text.match(new RegExp(`Total (?:paid|charge|amount)\\s*[-–:]?\\s*(${MONEY})`, "i")) ?? text.match(new RegExp(`(?:invoice|charged|credited)[^$]{0,80}(${MONEY})`, "i"));
  if (paid) facts.amount = paid[1];

  const location =
    text.match(/Returned to (.+?)(?= Total paid| View trip| Distance|$)/i) ??
    text.match(/\b(?:Location|Delivery)\s+(.+?)(?= About the guest| Special airport| Extras| Download the Turo| View trip|$)/i);
  if (location) facts.location = location[1].trim().slice(0, 120);

  const phone = text.match(/About the guest\s+.{1,60}?\s(\+?[\d(][\d\s().-]{8,}\d)/i);
  if (phone) facts.guestPhone = phone[1].trim();

  const distance = text.match(/(?:Total )?distance included\s+([\d,]+\s*(?:km|mi))/i);
  if (distance) facts.distance = distance[1];

  const changes = text.match(/Here(?:’|')s what .+? (?:would like to change|changed):\s*(.+?)\s+(?:Reply|Confirm or decline|You have until|Booked trip)\b/i);
  if (changes) {
    // The note follows the last change, after its own sentence.
    let last = changes[1].split(/\s+[–—-]\s+/).at(-1)?.replace(/^[–—-]\s*/, "") ?? "";
    const known =
      /^(?:New trip (?:start|end) on .+?\d{1,2}:\d{2}\s*[ap]\.?m\.?|Your earnings (?:won(?:’|')t change|will (?:increase|decrease)[^.]*)\.?|Pickup and return at .+?\b[A-Z]\d[A-Z] ?\d[A-Z]\d)\s*/i;
    for (let match = last.match(known); match; match = last.match(known)) last = last.slice(match[0].length);
    if (last && !/^(?:Return to|Pickup at|Delivery)/i.test(last)) facts.guestNote = last.slice(0, 500);
  }

  const respond = text.match(/You have until (.+?) to (?:respond|accept|reply)/i);
  if (respond) {
    facts.respondBy = respond[1].trim();
    facts.respondByAt = parseRespondBy(facts.respondBy);
  }

  return facts;
}
