import { authenticateAgent, type AgentScope } from "@/lib/agent-auth";
import { AGENT_TIME_FORMAT } from "@/lib/agent-time";
import { corsPreflight, withCors } from "@/lib/agent-cors";
import { MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE } from "@/lib/agent-read";

export const runtime = "nodejs";

/**
 * What this API can answer, described to whoever is calling it.
 *
 * A language model handed a bare base URL has to guess at paths and
 * parameters, and guessing produces 404s that read to it as "the data
 * is not there" rather than "you asked wrong". One authenticated call
 * here removes the guessing: every endpoint, every filter, and the
 * shape of every response.
 *
 * Behind the same `read` scope as the data itself. The catalogue
 * describes the account's structure -- how many kinds of thing it
 * holds and what they are called -- which is not something to hand to
 * an unauthenticated caller just because it contains no rows.
 */
export async function GET(request: Request) {
  const agent = await authenticateAgent(request, "read");
  if (!agent) return withCors({ error: "UNAUTHORIZED" }, { status: 401 });

  const canWriteOrders = agent.scopes.includes("orders:write");
  const canWriteMessages = agent.scopes.includes("messages:write");
  // Listed only to a token that can call them: a read-only agent shown
  // write endpoints would try them, get 401, and conclude the token is
  // broken.
  const writeEndpoints = WRITE_ENDPOINTS.filter((endpoint) => agent.scopes.includes(endpoint.scope));

  return withCors({
    version: 1,
    scopes: agent.scopes,
    conventions: {
      auth: "Authorization: Bearer <token>",
      dates: "ISO 8601 UTC, e.g. 2026-08-24T07:00:00.000Z",
      money: "Numbers in the workspace currency (CAD), rounded to the cent. null means not recorded.",
      lists: "{ data: [...], nextCursor: string | null }. Pass nextCursor back as ?cursor= for the next page.",
      paging: `?limit= (default ${DEFAULT_PAGE_SIZE}, max ${MAX_PAGE_SIZE})`,
      errors:
        "{ error: CODE } with the matching HTTP status. UNAUTHORIZED, NOT_FOUND, VALIDATION_ERROR; the CSV import adds TURO_SYNC_PARSE_FAILED and TURO_SYNC_EMPTY_CSV (400), BILLING_LIMIT_EXCEEDED (402).",
    },
    endpoints: [
      {
        path: "/api/agent/account",
        method: "GET",
        summary: "One-call overview: fleet size, trips by status, money this month, and what is waiting on a human.",
      },
      {
        path: "/api/agent/vehicles",
        method: "GET",
        summary: "The fleet. Plate, model, owner, status, current cleaning fee.",
        query: {
          status: "available | maintenance | inactive",
          includeArchived: "true to include retired cars (default false)",
          ownerId: "only this owner's cars",
          q: "match plate, nickname, brand, model, VIN or Turo listing name",
        },
      },
      {
        path: "/api/agent/orders",
        method: "GET",
        summary: "Trips, newest pickup first.",
        query: {
          status: "booked | ongoing | completed | cancelled",
          source: "turo | offline",
          vehicleId: "trips on one car",
          ownerId: "trips on one owner's cars",
          from: "pickup on or after this date",
          to: "pickup on or before this date",
          hasConflict: "true for double-booked trips only",
          ownerSynced: "true / false — whether the trip has reached the owner's ledger",
          q: "match renter, plate, reservation id, notes",
        },
      },
      {
        path: "/api/agent/orders/{orderId}",
        method: "GET",
        summary: "One trip in full, including the per-charge breakdown from Turo's CSV and the cleaning fee this trip is priced at.",
      },
      {
        path: "/api/agent/owners",
        method: "GET",
        summary: "Revenue-share owners, their current commission terms, cars, and ledger balance.",
      },
      {
        path: "/api/agent/owners/{ownerId}/ledger",
        method: "GET",
        summary: "One owner's statement lines, newest first, with a running balance for the filtered range.",
        query: { from: "occurred on or after", to: "occurred on or before", kind: "ledger entry kind" },
      },
      {
        path: "/api/agent/threads",
        method: "GET",
        summary: "Guest conversations grouped by guest and car, with the matched trip, its Turo reservationId, whether anything is unanswered, and -- where it has been recorded -- the whole Turo conversation, host replies included (conversation, lastHostReplyAt).",
        query: {
          unansweredOnly: "true to return only threads still awaiting a reply",
          vehicleId: "threads about one car",
          q: "match guest name, car, plate or message text",
        },
      },
      {
        path: "/api/agent/pending-orders",
        method: "GET",
        summary: "Bookings Turo told us about that could not be placed on a car, with the candidates for each. These are the ones waiting on a human decision.",
      },
      {
        path: "/api/agent/message-templates",
        method: "GET",
        summary: "Saved canned replies, general or locked to one vehicle.",
        query: { vehicleId: "templates for one car plus the general ones" },
      },
    ],
    ...(writeEndpoints.length > 0 ? { writeEndpoints } : {}),
    notes: [
      canWriteOrders || canWriteMessages
        ? `This token can ${[
            canWriteOrders ? "import Turo trips (orders:write)" : null,
            canWriteMessages ? "record Turo conversation messages, host replies included (messages:write)" : null,
          ]
            .filter(Boolean)
            .join(" and ")}. It cannot change a price, a commission rule or a ledger line directly, and cannot delete anything.`
        : "This token is read-only. Nothing reachable from it can change an order, a price, or a ledger line.",
      "TATO cannot send a Turo message: there is no write access to that channel. Recording a message here does not send it; replies are still sent in Turo by a person.",
      "Guest phone numbers are returned unmasked, because an automation that contacts guests needs them. Treat this token as carrying customer PII.",
    ],
  });
}

/**
 * The write side. Each endpoint names the scope it needs, and a token
 * is shown only the ones it holds.
 *
 * Two doors into the importers the rest of TATO uses, not new ones. The
 * CSV route runs the imports page's code; the trips route runs the
 * booking mail's. So an agent's trip is matched to a car, deduplicated
 * on its reservation id and parked when ambiguous by exactly the code
 * that already does it, and a rule changed there changes here.
 */
const WRITE_ENDPOINTS: Array<{ scope: AgentScope } & Record<string, unknown>> = [
  {
    scope: "orders:write",
    path: "/api/agent/imports",
    method: "POST",
    summary:
      "Import Turo's trip-earnings CSV export, as downloaded. Same code as the CSV import page: cars matched by plate, amounts and fees recorded, the owner ledger updated, cancelled trips recorded as cancelled (kept on the calendar, not deleted). Re-importing the same file is safe -- trips are keyed on the reservation id.",
    body: {
      fileName: "string, e.g. the downloaded file's name (for the import history)",
      csv: "string, the CSV file's text exactly as Turo exported it",
      turoAccount:
        "optional. The co-host account the export came from, as Turo names it (\"Kevin's vehicles\" or \"Kevin\"). Omit for the main account.",
    },
    notes: [
      "Rows whose car is not in the fleet are reported as failures; the API never creates vehicles.",
      "Returns counts plus per-row failures with a reason.",
    ],
  },
  {
    scope: "orders:write",
    path: "/api/agent/trips",
    method: "POST",
    summary:
      "Push trips read from Turo's trip pages -- new bookings not yet in any CSV export, or changes made in Turo's own interface. Same code as Turo's booking email: a trip is placed on a car only when exactly one car answers to the model and year (or the plate you send matches one); otherwise it waits in pending-orders for a person. Amounts are not written; the CSV export settles them. What you send is remembered, so the Gmail sync will not move a newer date back to an older email's.",
    body: {
      turoAccount: "optional. Co-host account, as for the CSV import; applies to every trip in the request",
      observedAt: "optional ISO 8601. When the pages were read, if not just now",
      dryRun: "optional. true reports what would happen and writes nothing",
      trips: [
        {
          reservationId: "required. Turo's reservation id (digits)",
          status: "booked | ongoing | changed | cancelled | completed",
          vehicle: "the car as Turo writes it: \"Brand Model Year\", e.g. \"Toyota Sienna 2018\"",
          plate: "optional. If the page shows the licence plate, send it as shown: it decides the car",
          guestName: "optional",
          guestPhone: "optional",
          tripStart: AGENT_TIME_FORMAT,
          tripEnd: "same format as tripStart",
          pickupLocation: "optional",
        },
      ],
    },
    notes: [
      "At most 200 trips per request. Idempotent on reservationId.",
      "A finished trip keeps its recorded dates: completed trips are settled by the CSV, not moved by a page read.",
      "Returns created / updated / unchanged / pending counts, notPlaced (each trip that could not be put on one car, with how many cars matched), unknownPlates, and suspectedTimezoneShift -- trips refused because their times look like local times sent as UTC; resend those without an offset.",
    ],
  },
  {
    scope: "messages:write",
    path: "/api/agent/reservations",
    method: "GET",
    summary:
      "Which Turo conversations to read next: reservation ids ordered by the newest guest message TATO has seen, so the ones that moved come first.",
    query: { limit: "default 20, max 100" },
    returns: "{ reservationIds: string[] }. Open https://turo.com/us/en/reservation/{id}/messages for each.",
  },
  {
    scope: "messages:write",
    path: "/api/agent/messages",
    method: "POST",
    summary:
      "Record a Turo conversation as it appears on the reservation's messages page -- both the guest's messages and the host's replies. Turo emails TATO when a guest writes and never when the host answers, so the host's side exists in TATO only if something records it here. Recording does not send anything.",
    body: {
      reservationId: "required. Turo's reservation id (digits), the same one /api/agent/reservations returns",
      source: "optional. A label for this run, for tracing a bad read back",
      messages: [
        {
          direction: "inbound (from the guest) | outbound (from the host or a co-host)",
          body: "the message text",
          sentAt: AGENT_TIME_FORMAT,
          authorName: "optional",
          externalId: "optional. Turo's id for the message if the page exposes one; otherwise TATO fingerprints direction + time + text",
        },
      ],
    },
    notes: [
      "1 to 200 messages per request. Idempotent: re-sending a conversation updates changed text and adds new messages, never duplicates.",
      "Send the whole visible conversation each time; there is no need to work out which messages are new.",
      "Returns { created, updated }. GET /api/agent/threads then shows these under each thread's conversation.",
    ],
  },
];

export function OPTIONS() {
  return corsPreflight();
}
