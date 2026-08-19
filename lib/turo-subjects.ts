import { InboundEmailKind } from "@prisma/client";

/**
 * Deterministic parsing of Turo notification emails by subject.
 *
 * Turo's host notifications are generated from a small set of fixed
 * templates, so a pattern match on the subject is exact where a model
 * is merely probable. This exists because the model-only path failed
 * silently and expensively: when the Kimi extraction started returning
 * nothing, every message landed as OTHER, and the alert detectors --
 * which look for GUEST_MESSAGE -- reported "nothing needs your
 * attention" while a dozen guests waited on replies. An outage in a
 * component nobody was watching turned into blindness in the component
 * everybody was trusting.
 *
 * Same principle as the alert detectors: the classification a person
 * acts on is computed, not guessed. The model still runs, and still
 * supplies the things patterns cannot -- reservation ids, a readable
 * summary -- but it no longer decides what a message *is*, and it is
 * no longer on the path between an email arriving and it being
 * attributed to a guest and a car.
 *
 * Returns null for subjects that match nothing, which defers to the
 * model rather than forcing a wrong bucket.
 */

/** Turo renders possessives with a curly apostrophe; operators pasting
 *  subjects use a straight one. Normalise both, and collapse runs of
 *  whitespace. Case is deliberately preserved -- the guest's name is
 *  read out of this string and shown to a person. */
function normalize(subject: string) {
  return subject
    .replace(/[‘’ʼ]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The co-host prefix: "(Kevin's vehicle) - Guillaume has sent you...".
 *
 * Turo puts this in front of every notification for a listing that
 * lives on someone else's account and is managed from this one. It was
 * being stripped as noise. It is not noise -- it is the only thing in
 * the entire feed that says which Turo account a trip belongs to.
 *
 * That matters because a CSV export cannot cross accounts, so the
 * co-hosted cars were invisible to every import; the mailbox is the
 * one place both accounts arrive together. It also disambiguates:
 * "Tesla Model Y 2020" matches four cars in this fleet, and knowing
 * which account the mail came from can be what narrows it to one.
 *
 * Normalised to a key -- "(Kevin's vehicle)" becomes "kevin" -- so the
 * label's punctuation and wording cannot fork the same account into
 * two.
 */
function splitCoHostPrefix(subject: string) {
  const match = subject.match(/^\(([^)]*)\)\s*[-–—]\s*/);
  if (!match) return { account: null as string | null, rest: subject };

  const account = match[1]
    .replace(/'s\s+vehicles?$/i, "")
    .trim()
    .toLowerCase();

  return {
    account: account || null,
    rest: subject.slice(match[0].length),
  };
}

type Rule = {
  kind: InboundEmailKind;
  /** Guest messages and support threads are the two kinds a human has
   *  to answer; everything else is a notification to read. */
  needsAction: boolean;
  test: RegExp;
  /** Capture groups for the guest name and the vehicle, when the
   *  template carries them. Both optional -- a payout email names
   *  neither. */
  guestGroup?: number;
  vehicleGroup?: number;
};

/**
 * Order is significant. A cancellation subject still contains "trip
 * with your <car>", so the narrower rule has to be tried first.
 */
const RULES: Rule[] = [
  // "Re: Following up on your vehicle swap Reservation - 60123362"
  // Turo support replies keep the mail-client Re:/Fwd: prefix; the
  // templated notifications never do.
  { kind: InboundEmailKind.SUPPORT, needsAction: true, test: /^(?:re|fwd|fw)\s*:/i },

  // "yuechao has sent you a message about your Tesla Model 3"
  {
    kind: InboundEmailKind.GUEST_MESSAGE,
    needsAction: true,
    test: /^(.+?) has sent you a message about your (.+?)$/i,
    guestGroup: 1,
    vehicleGroup: 2,
  },

  {
    kind: InboundEmailKind.BOOKING_CANCELLED,
    needsAction: false,
    test: /^(.+?)'s trip with your (.+?) (?:has been |was )?cancell?ed/i,
    guestGroup: 1,
    vehicleGroup: 2,
  },

  // Catch-all cancellation for phrasings the pair above misses.
  { kind: InboundEmailKind.BOOKING_CANCELLED, needsAction: false, test: /\bcancell?ed\b/i },

  // "Anna's trip with your Honda CR-V is booked!"
  {
    kind: InboundEmailKind.BOOKING_CREATED,
    needsAction: false,
    test: /^(.+?)'s trip with your (.+?) is booked/i,
    guestGroup: 1,
    vehicleGroup: 2,
  },

  // "Jouber has added another driver to their trip with your Toyota bZ4X"
  {
    kind: InboundEmailKind.BOOKING_MODIFIED,
    needsAction: false,
    test: /^(.+?) has added another driver to their trip with your (.+?)$/i,
    guestGroup: 1,
    vehicleGroup: 2,
  },
  {
    kind: InboundEmailKind.BOOKING_MODIFIED,
    needsAction: false,
    test: /(?:has been (?:changed|modified|extended)|trip (?:change|extension))/i,
  },

  // "Katherine has returned your Toyota 4Runner 2022"
  {
    kind: InboundEmailKind.TRIP_ENDED,
    needsAction: false,
    test: /^(.+?) has returned your (.+?)$/i,
    guestGroup: 1,
    vehicleGroup: 2,
  },

  // "Katherine has picked up your Toyota 4Runner 2022"
  {
    kind: InboundEmailKind.TRIP_STARTED,
    needsAction: false,
    test: /^(.+?) has picked up your (.+?)$/i,
    guestGroup: 1,
    vehicleGroup: 2,
  },

  // "Paul has an upcoming trip with your Buick Verano"
  {
    kind: InboundEmailKind.BOOKING_MODIFIED,
    needsAction: false,
    test: /^(.+?) has an upcoming trip with your (.+?)$/i,
    guestGroup: 1,
    vehicleGroup: 2,
  },

  // "Your earnings are on the way!" / reimbursement invoice charges
  {
    kind: InboundEmailKind.PAYOUT,
    needsAction: false,
    test: /(?:your earnings are on the way|has been charged for your reimbursement invoice)/i,
  },
];

export type TuroSubjectMatch = {
  kind: InboundEmailKind;
  needsAction: boolean;
  /** Which Turo account this listing sits on. Null is the main
   *  account; anything else is a co-hosted listing whose trips never
   *  appear in this account's CSV export. */
  coHostAccount: string | null;
  /** As written by Turo, for display and for matching against orders. */
  guestName: string | null;
  /** The listing text, e.g. "Tesla Model 3" or "Toyota 4Runner 2022". */
  vehicleText: string | null;
};

export function classifyTuroSubject(subject: string): TuroSubjectMatch | null {
  const { account, rest } = splitCoHostPrefix(normalize(subject));
  const normalized = rest.trim();
  if (!normalized) return null;

  for (const rule of RULES) {
    const match = normalized.match(rule.test);
    if (!match) continue;

    const guestName = rule.guestGroup ? (match[rule.guestGroup]?.trim() || null) : null;
    const vehicleText = rule.vehicleGroup
      ? (match[rule.vehicleGroup]?.replace(/[!.]+$/, "").trim() || null)
      : null;

    return {
      kind: rule.kind,
      needsAction: rule.needsAction,
      coHostAccount: account,
      guestName,
      vehicleText,
    };
  }

  return null;
}

/**
 * The link Turo itself put in the notification.
 *
 * Extracted rather than constructed. Building a URL from a reservation
 * id would mean hard-coding Turo's routing and re-learning it every
 * time they change it; the email already contains a link that Turo
 * guarantees works, including whatever tracking wrapper they route it
 * through. Tracking hosts still sit under turo.com, so the host test
 * catches them and the redirect lands in the right place.
 *
 * Returns null when the body carries no Turo link, which is a normal
 * outcome for a plain-text digest.
 */
export function extractTuroLink(bodyText: string): string | null {
  const urls = bodyText.match(/https?:\/\/[^\s<>()[\]"']+/gi);
  if (!urls) return null;

  const turoUrls = urls
    // Trailing punctuation from prose wrapping ("...trips/123.") is not
    // part of the URL.
    .map((url) => url.replace(/[.,;:!?]+$/, ""))
    .filter((url) => {
      try {
        const host = new URL(url).hostname.toLowerCase();
        return host === "turo.com" || host.endsWith(".turo.com");
      } catch {
        return false;
      }
    });

  if (turoUrls.length === 0) return null;

  // Prefer a link that goes somewhere useful. Turo footers carry help
  // centre and unsubscribe links on the same domain, and opening the
  // help centre when the operator wanted the conversation is worse
  // than offering nothing.
  const meaningful = turoUrls.find((url) =>
    /\/(trips?|reservations?|inbox|messages?|conversations?)\b/i.test(url),
  );

  return (meaningful ?? turoUrls[0]).slice(0, 1_000);
}

/**
 * The guest's profile photo, from the HTML part of a notification.
 *
 * Turo's message emails lay out three images in a fixed order: the
 * wordmark, the guest's avatar, then the vehicle. The avatar is the
 * one served from their user-content bucket, so that is what this
 * looks for rather than counting positions -- a template change that
 * adds a banner would break counting and leave the operator looking at
 * a picture of a car where a person should be.
 *
 * Returns null for anything it is not confident about. An initials
 * avatar is a fine outcome; the wrong person's face is not.
 */
export function extractGuestAvatar(html: string): string | null {
  if (!html) return null;

  const candidates: string[] = [];
  for (const match of html.matchAll(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi)) {
    candidates.push(match[1]);
  }

  const usable = candidates.filter((url) => {
    if (!/^https?:\/\//i.test(url)) return false;
    // Layout chrome: spacers, wordmarks, icons, tracking pixels.
    if (/logo|wordmark|icon|spacer|pixel|footer|social|badge|star/i.test(url)) return false;
    try {
      const host = new URL(url).hostname.toLowerCase();
      return host.endsWith("turo.com") || host.includes("turo");
    } catch {
      return false;
    }
  });

  // Turo serves guest photos from a driver/profile path and vehicle
  // shots from a vehicle path. Prefer an explicit profile hit; take
  // nothing rather than guess between two unlabelled images.
  const profile = usable.find((url) => /driver|profile|avatar|user|people|face/i.test(url));
  return profile ? profile.slice(0, 500) : null;
}

/**
 * What the guest actually wrote.
 *
 * Turo wraps the guest's words in a notification: a header line that
 * restates the subject, then their message, then a "Reply <url>" call
 * to action, then trip details and legal footer. Their text is the
 * part between the header and the CTA, and it is sitting there in
 * plain sight -- which matters, because the page had been showing a
 * model's summary of it instead. A summary of one sentence is not a
 * better version of that sentence; it is a paraphrase of the only
 * thing on the screen the operator needs to read exactly.
 *
 * Deterministic. The model still writes the Chinese and still judges
 * whether a reply is needed, but it no longer stands between the guest
 * and the person reading them.
 *
 * Returns null when the shape is not recognised, so the caller can
 * fall back rather than show a slice of boilerplate.
 */
export function extractGuestMessageText(bodyText: string, subject: string): string | null {
  if (!bodyText) return null;

  const normalized = bodyText.replace(/\r\n/g, "\n");

  // The CTA marks the end of the quoted message in every template that
  // carries one.
  const ctaIndex = normalized.search(/\n\s*Reply\s+https?:\/\//i);
  const head = ctaIndex >= 0 ? normalized.slice(0, ctaIndex) : normalized;

  const lines = head
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return null;

  // Drop the header line, which is the subject with a full stop. Match
  // on the shared prefix rather than equality: Turo appends the car to
  // one and not always the other.
  const subjectStem = subject.replace(/[.!]$/, "").slice(0, 40).toLowerCase();
  const body = lines.filter((line) => {
    const lower = line.toLowerCase();
    if (subjectStem && lower.startsWith(subjectStem.slice(0, Math.min(30, subjectStem.length)))) {
      return false;
    }
    // Template furniture that survives when the CTA is worded
    // differently.
    return !/^(reply|view (trip|car) details|booked trip|cancelled trip)\b/i.test(line);
  });

  const text = body.join("\n").trim();
  if (!text || text.length < 2) return null;

  // Guard against grabbing the trip-details block when a notification
  // carries no guest message at all: those start with the vehicle line
  // and read as a spec sheet, never as a sentence.
  if (/^[A-Z][\w-]* [\w-]+ (19|20)\d{2}$/.test(text.split("\n")[0] ?? "")) return null;

  return text.slice(0, 2000);
}
