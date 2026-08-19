import { InboundEmailKind } from "@prisma/client";

/**
 * Deterministic classification of Turo notification emails by subject.
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
 * supplies the things patterns cannot -- reservation ids, guest names,
 * a readable summary -- but it no longer decides what a message *is*.
 *
 * Returns null for subjects that match nothing, which defers to the
 * model rather than forcing a wrong bucket.
 */

/** Turo renders possessives with a curly apostrophe; operators pasting
 *  subjects use a straight one. Normalise both, plus case and runs of
 *  whitespace, before matching. */
function normalize(subject: string) {
  return subject
    .replace(/[‘’ʼ]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

type Rule = {
  kind: InboundEmailKind;
  /** Guest messages and support threads are the two kinds a human has
   *  to answer; everything else is a notification to read. */
  needsAction: boolean;
  test: RegExp;
};

/**
 * Order is significant. A cancellation subject still contains "trip
 * with your <car>", so the narrower rule has to be tried first.
 */
const RULES: Rule[] = [
  // "Re: Following up on your vehicle swap Reservation - 60123362"
  // Turo support replies keep the mail-client Re:/Fwd: prefix; the
  // templated notifications never do.
  { kind: InboundEmailKind.SUPPORT, needsAction: true, test: /^(re|fwd|fw)\s*:/ },

  // "yuechao has sent you a message about your Tesla Model 3"
  // Also "(Kevin's vehicle) - Guillaume has sent you a message ..." --
  // co-hosted cars carry a bracketed prefix, so this is not anchored.
  {
    kind: InboundEmailKind.GUEST_MESSAGE,
    needsAction: true,
    test: /has sent you a message about your /,
  },

  {
    kind: InboundEmailKind.BOOKING_CANCELLED,
    needsAction: false,
    test: /\b(cancell?ed|has been cancell?ed)\b/,
  },

  // "Anna's trip with your Honda CR-V is booked!"
  { kind: InboundEmailKind.BOOKING_CREATED, needsAction: false, test: /trip with your .+ is booked/ },

  // "Jouber has added another driver to their trip with your Toyota bZ4X"
  {
    kind: InboundEmailKind.BOOKING_MODIFIED,
    needsAction: false,
    test: /(has added another driver|has been (changed|modified|extended)|trip (change|extension))/,
  },

  // "Katherine has returned your Toyota 4Runner 2022"
  { kind: InboundEmailKind.TRIP_ENDED, needsAction: false, test: /has returned your /},

  // "X has picked up your Y"
  { kind: InboundEmailKind.TRIP_STARTED, needsAction: false, test: /has picked up your /},

  // "Your earnings are on the way!" / reimbursement invoice charges
  {
    kind: InboundEmailKind.PAYOUT,
    needsAction: false,
    test: /(your earnings are on the way|has been charged for your reimbursement invoice)/,
  },
];

export type TuroSubjectMatch = {
  kind: InboundEmailKind;
  needsAction: boolean;
};

export function classifyTuroSubject(subject: string): TuroSubjectMatch | null {
  const normalized = normalize(subject);
  if (!normalized) return null;

  for (const rule of RULES) {
    if (rule.test.test(normalized)) {
      return { kind: rule.kind, needsAction: rule.needsAction };
    }
  }

  return null;
}
