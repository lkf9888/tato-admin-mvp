import { authenticateAgent } from "@/lib/agent-auth";
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

  return withCors({
    version: 1,
    scopes: agent.scopes,
    conventions: {
      auth: "Authorization: Bearer <token>",
      dates: "ISO 8601 UTC, e.g. 2026-08-24T07:00:00.000Z",
      money: "Numbers in the workspace currency (CAD), rounded to the cent. null means not recorded.",
      lists: "{ data: [...], nextCursor: string | null }. Pass nextCursor back as ?cursor= for the next page.",
      paging: `?limit= (default ${DEFAULT_PAGE_SIZE}, max ${MAX_PAGE_SIZE})`,
      errors: "{ error: CODE } with the matching HTTP status. UNAUTHORIZED, NOT_FOUND, VALIDATION_ERROR.",
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
        summary: "Guest conversations grouped by guest and car, with the matched trip and whether anything is unanswered.",
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
    notes: [
      "This token is read-only. Nothing reachable from it can change an order, a price, or a ledger line.",
      "TATO cannot send a Turo message: there is no write access to that channel. Reply text still has to be pasted into Turo by a person.",
      "Guest phone numbers are returned unmasked, because an automation that contacts guests needs them. Treat this token as carrying customer PII.",
    ],
  });
}

export function OPTIONS() {
  return corsPreflight();
}
