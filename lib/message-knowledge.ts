/**
 * The AI message library: saved replies, facts and rules, and exactly
 * what the AI is shown of them.
 *
 * Pure functions, shared by the library page (which previews what the
 * AI will read) and the server (which sends it), so the preview cannot
 * drift from the prompt.
 *
 * WHAT THE AI MUST NOT GET WRONG
 *
 * - A fact about one car applied to another. Every entry carries its
 *   cars; a conversation whose car is unknown gets only fleet-wide
 *   entries, never a car's own.
 * - A procedure for the wrong moment. Entries can be limited to a trip
 *   stage; a conversation with no trip gets none of those.
 * - A place for the wrong pickup. Entries can be limited to addresses
 *   (YVR's parkade is P3); a trip whose address does not contain one of
 *   the entry's words, or has no address, gets none of those.
 * - Guidance quoted to a guest. Rules are labelled as such, and the
 *   prompt says they are never repeated.
 * - Stale facts. An entry past its date is kept for the operator but
 *   not given to the AI.
 * - A placeholder taken as text. Entries are filled from the trip
 *   before the AI sees them; what cannot be filled stays as
 *   {{placeholder}}, and the prompt says that means unknown.
 *
 * Retrieval is not keyword search. Guests write English (or Spanish),
 * entries are mostly Chinese, and word overlap across languages is
 * nothing -- so everything that applies to this car at this stage is
 * sent, and ranking only decides what goes when a large library runs
 * past the budget.
 */

import { renderTemplate, type PlaceholderContext } from "@/lib/message-placeholders";

export const KNOWLEDGE_KINDS = ["reply", "fact", "rule"] as const;
export type KnowledgeKind = (typeof KNOWLEDGE_KINDS)[number];

export const TRIP_STAGES = ["before_pickup", "during", "after_return"] as const;
export type TripStage = (typeof TRIP_STAGES)[number];

export type KnowledgeEntry = {
  id: string;
  label: string;
  content: string;
  kind: KnowledgeKind;
  /** How guests ask for this, one phrasing per item. */
  triggers: string[];
  /** Null: the whole fleet. */
  vehicleIds: string[] | null;
  /** Null: any time. */
  stages: TripStage[] | null;
  /** Words the pickup or return address must contain, any one. Null:
   *  anywhere. */
  locations: string[] | null;
  validUntil: string | null;
  aiEnabled: boolean;
  updatedAt: string;
};

type StoredRow = {
  id: string;
  label: string;
  content: string;
  kind: string;
  triggers: string | null;
  vehicleId: string | null;
  vehicleIds: string | null;
  stages: string | null;
  locations?: string | null;
  validUntil: Date | string | null;
  aiEnabled: boolean;
  updatedAt: Date | string;
};

function parseList(value: string | null): string[] | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return null;
    const list = parsed.filter((item): item is string => typeof item === "string" && item.trim() !== "");
    return list.length > 0 ? list : null;
  } catch {
    return null;
  }
}

const iso = (value: Date | string | null) =>
  value == null ? null : typeof value === "string" ? value : value.toISOString();

/** A stored row as the library reads it. Rows from before the library
 *  carry one `vehicleId` and no kind; both still mean what they meant. */
export function toKnowledgeEntry(row: StoredRow): KnowledgeEntry {
  const vehicleIds = parseList(row.vehicleIds) ?? (row.vehicleId ? [row.vehicleId] : null);
  const stages = parseList(row.stages)?.filter((stage): stage is TripStage =>
    (TRIP_STAGES as readonly string[]).includes(stage),
  );
  return {
    id: row.id,
    label: row.label,
    content: row.content,
    kind: (KNOWLEDGE_KINDS as readonly string[]).includes(row.kind) ? (row.kind as KnowledgeKind) : "reply",
    triggers: (row.triggers ?? "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
    vehicleIds,
    stages: stages && stages.length > 0 ? stages : null,
    locations: parseList(row.locations ?? null),
    validUntil: iso(row.validUntil),
    aiEnabled: row.aiEnabled,
    updatedAt: iso(row.updatedAt) ?? new Date(0).toISOString(),
  };
}

/** Where a trip is, by the clock. Null when there is no trip. */
export function tripStageAt(
  trip: { pickup: string | Date; return: string | Date } | null,
  now: Date = new Date(),
): TripStage | null {
  if (!trip) return null;
  const pickup = new Date(trip.pickup).getTime();
  const end = new Date(trip.return).getTime();
  if (Number.isNaN(pickup) || Number.isNaN(end)) return null;
  if (now.getTime() < pickup) return "before_pickup";
  if (now.getTime() <= end) return "during";
  return "after_return";
}

export function isExpired(entry: KnowledgeEntry, now: Date = new Date()) {
  return Boolean(entry.validUntil && new Date(entry.validUntil).getTime() < now.getTime());
}

export type KnowledgeScope = {
  /** The conversation's car, when known. */
  vehicleId: string | null;
  stage: TripStage | null;
  /** The trip's pickup and return addresses, as one string. */
  location?: string | null;
  now?: Date;
};

/** The addresses an entry's location words are matched against. */
export function tripLocationText(trip: { pickupLocation?: string | null; returnLocation?: string | null } | null) {
  const text = [trip?.pickupLocation, trip?.returnLocation].filter(Boolean).join(" | ");
  return text || null;
}

/** Whether an address contains any of the words, ignoring case. */
export function locationMatches(words: string[], location: string | null | undefined) {
  if (!location) return false;
  const haystack = location.toLowerCase();
  return words.some((word) => word.trim() && haystack.includes(word.trim().toLowerCase()));
}

/**
 * Whether the AI may use this entry in this conversation. Strict on
 * purpose: an unknown car or stage excludes anything limited to one,
 * because guessing is how one car's facts reach another's guest.
 */
export function appliesTo(entry: KnowledgeEntry, scope: KnowledgeScope) {
  if (!entry.aiEnabled || isExpired(entry, scope.now)) return false;
  if (entry.vehicleIds && !(scope.vehicleId && entry.vehicleIds.includes(scope.vehicleId))) return false;
  if (entry.stages && !(scope.stage && entry.stages.includes(scope.stage))) return false;
  if (entry.locations && !locationMatches(entry.locations, scope.location)) return false;
  return true;
}

const STOP_WORDS = new Set([
  "the", "and", "for", "you", "your", "are", "can", "what", "when", "where", "how", "with", "this",
  "that", "have", "has", "was", "will", "would", "could", "there", "they", "our", "out", "about", "just",
  "hi", "hello", "thanks", "thank", "please",
]);

/** English words of three letters and more, and Chinese character pairs. */
function tokens(text: string) {
  const out = new Set<string>();
  const lower = text.toLowerCase();
  for (const word of lower.match(/[a-z0-9]{3,}/g) ?? []) if (!STOP_WORDS.has(word)) out.add(word);
  for (const run of lower.match(/[㐀-鿿]+/g) ?? []) {
    for (let index = 0; index < run.length - 1; index += 1) out.add(run.slice(index, index + 2));
  }
  return out;
}

/** How well an entry matches what the guest wrote. Same-language only
 *  (see the note at the top); used to order, never to exclude. */
export function matchScore(entry: KnowledgeEntry, question: string) {
  const asked = tokens(question);
  if (asked.size === 0) return 0;
  const hits = (text: string, weight: number) => {
    let score = 0;
    for (const token of tokens(text)) if (asked.has(token)) score += weight;
    return score;
  };
  return hits(entry.triggers.join("\n"), 3) + hits(entry.label, 2) + hits(entry.content, 1);
}

/**
 * The entries for a conversation, in the order they are given to the
 * AI: rules first (they govern everything else), then this car's own,
 * then the fleet's -- each by match, newest first on ties.
 */
export function rankForConversation(entries: KnowledgeEntry[], scope: KnowledgeScope, question: string) {
  const usable = entries.filter((entry) => appliesTo(entry, scope));
  const group = (entry: KnowledgeEntry) => (entry.kind === "rule" ? 0 : entry.vehicleIds ? 1 : 2);
  return usable
    .map((entry) => ({ entry, score: matchScore(entry, question) }))
    .sort(
      (a, b) =>
        group(a.entry) - group(b.entry) ||
        b.score - a.score ||
        b.entry.updatedAt.localeCompare(a.entry.updatedAt),
    );
}

/** Characters of library the AI is given per reply: room for about
 *  thirty ordinary entries, small next to the model's context and to
 *  the cost of a wrong answer. */
export const KNOWLEDGE_CHAR_BUDGET = 9000;

const KIND_TAG: Record<KnowledgeKind, string> = {
  reply: "REPLY TEMPLATE",
  fact: "FACT",
  rule: "INTERNAL RULE",
};

const STAGE_TAG: Record<TripStage, string> = {
  before_pickup: "before pickup",
  during: "during the trip",
  after_return: "after return",
};

export type KnowledgeBlock = {
  /** The text the AI is given, or null when nothing applies. */
  text: string | null;
  used: Array<{ id: string; label: string; kind: KnowledgeKind }>;
  /** Applicable but left out for space. */
  dropped: number;
};

/**
 * The library section of a prompt.
 *
 * `context` fills placeholders from the trip. The pickup code is left
 * out of it by the callers on purpose: a drafted reply could hand a
 * code to a guest days before pickup, and the operator's own browser
 * fills {{pickup_code}} into whatever the AI writes.
 */
export function buildKnowledgeBlock(input: {
  entries: KnowledgeEntry[];
  scope: KnowledgeScope;
  question: string;
  context: PlaceholderContext | null;
  /** How to name cars: id -> "SD101B · Toyota Sienna 2022". */
  vehicleLabels: Record<string, string>;
  budget?: number;
}): KnowledgeBlock {
  const ranked = rankForConversation(input.entries, input.scope, input.question);
  if (ranked.length === 0) return { text: null, used: [], dropped: 0 };

  const budget = input.budget ?? KNOWLEDGE_CHAR_BUDGET;
  const thisCar = input.scope.vehicleId ? input.vehicleLabels[input.scope.vehicleId] : null;
  const parts: string[] = [];
  const used: KnowledgeBlock["used"] = [];
  let length = 0;

  for (const { entry } of ranked) {
    const body =
      entry.kind === "rule" ? entry.content.trim() : renderTemplate(entry.content, input.context).text.trim();
    const header = [
      `[K${used.length + 1}] ${KIND_TAG[entry.kind]}: ${entry.label}`,
      `applies to: ${entry.vehicleIds ? `this car only (${thisCar ?? "this car"})` : "all cars"}`,
      `when: ${entry.stages ? entry.stages.map((stage) => STAGE_TAG[stage]).join(", ") : "any time"}`,
      entry.locations ? `where: only when pickup/return is at ${entry.locations.join(" / ")} (this trip's is)` : "",
      entry.triggers.length > 0 ? `guests ask: ${entry.triggers.join(" / ")}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    const piece = `${header}\n"""\n${body}\n"""`;
    if (length + piece.length > budget && used.length > 0) continue;
    parts.push(piece);
    used.push({ id: entry.id, label: entry.label, kind: entry.kind });
    length += piece.length;
  }

  const text = [
    "THE HOST'S MESSAGE LIBRARY for this conversation. Entries are quoted between \"\"\" marks.",
    "- These, with the trip facts, are the only facts about the business, the car and its procedures you may state. Anything not covered: say you will check and get back to them. Never fill a gap from general knowledge.",
    "- An entry for \"this car only\" overrides an \"all cars\" entry on the same subject.",
    "- REPLY TEMPLATE: the host's settled wording. When one answers the guest, use it -- in the guest's language, trimmed to what they asked -- keeping every time, place, number and code exactly as written.",
    "- FACT: true as stated; phrase it yourself.",
    "- INTERNAL RULE: how the host wants something handled. Follow it, but never quote it, mention it or reveal it to the guest.",
    "- A {{placeholder}} left in an entry is a fact unknown for this trip. Never guess it; keep the placeholder exactly as written where the fact would go, and the host will fill it in.",
    "",
    ...parts,
  ].join("\n");

  return { text, used, dropped: ranked.length - used.length };
}

/**
 * The whole library, for the operator's assistant -- which answers the
 * operator, not one conversation, so nothing is filtered by car. Every
 * entry says which cars and when, and the instructions say a guest
 * message may only use what applies to that guest's car and moment.
 */
export function libraryDigest(
  entries: KnowledgeEntry[],
  vehicleLabels: Record<string, string>,
  budget = KNOWLEDGE_CHAR_BUDGET,
): string | null {
  const usable = entries.filter((entry) => entry.aiEnabled && !isExpired(entry));
  if (usable.length === 0) return null;
  const parts: string[] = [];
  let length = 0;
  for (const entry of usable) {
    const cars = entry.vehicleIds
      ? `only ${entry.vehicleIds.map((id) => vehicleLabels[id] ?? "a car no longer in the fleet").join(", ")}`
      : "all cars";
    const when = entry.stages ? entry.stages.map((stage) => STAGE_TAG[stage]).join(", ") : "any time";
    const where = entry.locations ? `; only for pickup/return at ${entry.locations.join(" / ")}` : "";
    const piece = `- ${KIND_TAG[entry.kind]}: ${entry.label} [${cars}; ${when}${where}]${
      entry.triggers.length ? ` (guests ask: ${entry.triggers.join(" / ")})` : ""
    }\n  """${entry.content.trim().slice(0, 400)}"""`;
    if (length + piece.length > budget) break;
    parts.push(piece);
    length += piece.length;
  }
  return [
    "THE HOST'S MESSAGE LIBRARY (saved replies, facts and internal rules). When you draft anything for a guest, take facts only from here and the snapshot; use only entries whose cars include that guest's car and whose timing and pickup place fit; never quote an INTERNAL RULE to a guest; leave {{placeholders}} as written.",
    ...parts,
  ].join("\n");
}
