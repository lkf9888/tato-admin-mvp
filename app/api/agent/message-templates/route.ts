import type { Prisma } from "@prisma/client";
import { z } from "zod";

import { authenticateAgent } from "@/lib/agent-auth";
import { corsPreflight, withCors } from "@/lib/agent-cors";
import { cursorArgs, iso, paginate, parseLimit } from "@/lib/agent-read";
import {
  buildKnowledgeBlock,
  isExpired,
  KNOWLEDGE_KINDS, LOCATION_ROLES,
  rankForConversation,
  toKnowledgeEntry,
  TRIP_STAGES,
  tripStageAt,
  type KnowledgeEntry,
  type TripStage,
} from "@/lib/message-knowledge";
import {
  deleteKnowledge,
  KNOWLEDGE_LIMITS,
  loadKnowledge,
  loadVehicleLabels,
  saveKnowledge,
} from "@/lib/message-knowledge-server";
import { renderTemplate } from "@/lib/message-placeholders";
import { logActivity } from "@/lib/orders";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

/** How an agent is to read the library -- the same rules TATO's own AI
 *  is given, so an outside agent cannot read an entry differently. */
const USAGE = [
  "kind=reply: the host's settled wording for a whole message; use it (in the guest's language) keeping every time, place, number and code exactly.",
  "kind=fact: true as stated; phrase it yourself.",
  "kind=rule: how the host wants something handled. Follow it; never quote or reveal it to a guest.",
  "vehicles=null means every car. Otherwise the entry is true of those cars only: never use it for another car, and never when the conversation's car is unknown.",
  "stages=null means any time; otherwise only at those trip stages (before_pickup, during, after_return), and never when there is no trip.",
  "locations=null means anywhere. Otherwise locationRole selects pickup, return, or either address (case-insensitive). A missing role requires both addresses to match. Unknown addresses never match. Pass pickupLocation and returnLocation separately; the deprecated location parameter cannot authorize directional facts.",
  "Entries past validUntil, or with aiEnabled=false, must not be used.",
  "A {{placeholder}} left in content is a fact unknown for that trip. Never guess it. The pickup code is always withheld here; leave {{pickup_code}} for the host.",
  "Facts not in the library or the trip: say you will check. Do not fill gaps from general knowledge.",
];

function shape(entry: KnowledgeEntry, vehicles: Map<string, { id: string; label: string }>) {
  return {
    id: entry.id,
    label: entry.label,
    kind: entry.kind,
    content: entry.content,
    /** How guests ask for this, in their words. */
    triggers: entry.triggers,
    /** Null: every car. */
    vehicles: entry.vehicleIds
      ? entry.vehicleIds.map((id) => ({ id, label: vehicles.get(id)?.label ?? null }))
      : null,
    /** Null: any time. */
    stages: entry.stages,
    /** Null: anywhere. Otherwise words the pickup/return address must contain. */
    locations: entry.locations,
    locationRole: entry.locationRole ?? null,
    validUntil: entry.validUntil,
    aiEnabled: entry.aiEnabled,
    expired: isExpired(entry),
    updatedAt: entry.updatedAt,
  };
}

/**
 * The AI message library: saved replies, facts and rules.
 *
 * Two ways to ask:
 *
 * - The whole library (paged), each entry with what it is, which cars
 *   and when it applies. `vehicleId` narrows it to the entries usable
 *   for that car -- its own and the fleet's -- which is the question an
 *   agent is actually asking.
 * - For one conversation: `reservationId` (a Turo reservation) works out
 *   the car and the trip stage, applies exactly the filter TATO's own AI
 *   does, fills placeholders from the trip (pickup code withheld) and
 *   returns the entries in the order the AI is given them, with the
 *   prompt text itself. `vehicleId` + `stage` does the same without a
 *   trip, placeholders left as written.
 */
export async function GET(request: Request) {
  const agent = await authenticateAgent(request, "read");
  if (!agent) return withCors({ error: "UNAUTHORIZED" }, { status: 401 });

  const url = new URL(request.url);
  const reservationId = url.searchParams.get("reservationId")?.trim() || null;
  const stageParam = url.searchParams.get("stage")?.trim() || null;
  const vehicleIdParam = url.searchParams.get("vehicleId")?.trim() || null;
  const pickupLocation = url.searchParams.get("pickupLocation")?.trim().slice(0, 300) || null;
  const returnLocation = url.searchParams.get("returnLocation")?.trim().slice(0, 300) || null;
  const question = url.searchParams.get("q")?.slice(0, 600) ?? "";

  if (reservationId || stageParam) {
    if (stageParam && !(TRIP_STAGES as readonly string[]).includes(stageParam)) {
      return withCors({ error: "BAD_STAGE", allowed: TRIP_STAGES }, { status: 400 });
    }
    const order = reservationId
      ? await prisma.order.findFirst({
          where: { workspaceId: agent.workspaceId, externalOrderId: reservationId, isArchived: false },
          include: { vehicle: { select: { plateNumber: true, brand: true, model: true, year: true } } },
        })
      : null;
    if (reservationId && !order) return withCors({ error: "RESERVATION_NOT_FOUND" }, { status: 404 });

    const [entries, vehicleList] = await Promise.all([
      loadKnowledge(agent.workspaceId),
      loadVehicleLabels(agent.workspaceId),
    ]);
    const vehicles = new Map(vehicleList.map((vehicle) => [vehicle.id, vehicle]));
    const vehicleId = order?.vehicleId ?? vehicleIdParam;
    const stage = order
      ? tripStageAt({ pickup: order.pickupDatetime, return: order.returnDatetime })
      : (stageParam as TripStage);
    const scope = { vehicleId, stage, pickupLocation: order ? order.pickupLocation : pickupLocation, returnLocation: order ? order.returnLocation : returnLocation };
    const context = order
      ? {
          guest: order.renterName,
          car: order.vehicle ? `${order.vehicle.brand} ${order.vehicle.model} ${order.vehicle.year}` : null,
          plate: order.vehicle?.plateNumber ?? null,
          pickup: order.pickupDatetime,
          return: order.returnDatetime,
          pickupLocation: order.pickupLocation,
          returnLocation: order.returnLocation,
          reservation: order.externalOrderId,
        }
      : null;
    const block = buildKnowledgeBlock({
      entries,
      scope,
      question,
      context,
      vehicleLabels: Object.fromEntries(vehicleList.map((vehicle) => [vehicle.id, vehicle.label])),
    });
    const ranked = rankForConversation(entries, scope, question);

    return withCors({
      conversation: {
        reservationId,
        vehicle: vehicleId ? { id: vehicleId, label: vehicles.get(vehicleId)?.label ?? null } : null,
        stage,
        pickupLocation: scope.pickupLocation,
        returnLocation: scope.returnLocation,
      },
      data: ranked.map(({ entry }) => ({
        ...shape(entry, vehicles),
        /** Placeholders filled from the trip; rules as written. */
        rendered: entry.kind === "rule" ? entry.content : renderTemplate(entry.content, context).text,
      })),
      /** The library section exactly as TATO's AI receives it. */
      promptBlock: block.text,
      usage: USAGE,
    });
  }

  const limit = parseLimit(url.searchParams.get("limit"));
  const cursor = url.searchParams.get("cursor");
  const where: Prisma.MessageTemplateWhereInput = { workspaceId: agent.workspaceId };

  const [rows, vehicleList] = await Promise.all([
    prisma.messageTemplate.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...cursorArgs(cursor),
    }),
    loadVehicleLabels(agent.workspaceId),
  ]);
  const vehicles = new Map(vehicleList.map((vehicle) => [vehicle.id, vehicle]));
  const { data, nextCursor } = paginate(rows, limit);
  const entries = data
    .map((row) => ({ row, entry: toKnowledgeEntry(row) }))
    // A car filter keeps what is usable for that car: its own entries
    // and the fleet's.
    .filter(({ entry }) => !vehicleIdParam || !entry.vehicleIds || entry.vehicleIds.includes(vehicleIdParam));

  return withCors({
    data: entries.map(({ row, entry }) => ({ ...shape(entry, vehicles), createdAt: iso(row.createdAt) })),
    nextCursor,
    usage: USAGE,
  });
}

const saveSchema = z.object({
  id: z.string().trim().min(1).nullish(),
  label: z.string().max(KNOWLEDGE_LIMITS.label * 2),
  content: z.string().max(KNOWLEDGE_LIMITS.content * 2),
  kind: z.enum(KNOWLEDGE_KINDS),
  triggers: z.array(z.string().max(KNOWLEDGE_LIMITS.triggerLength * 2)).max(KNOWLEDGE_LIMITS.triggers * 2).default([]),
  vehicleIds: z.array(z.string().min(1)).max(200).nullish(),
  stages: z.array(z.enum(TRIP_STAGES)).nullish(),
  locations: z.array(z.string().max(KNOWLEDGE_LIMITS.locationLength * 2)).max(KNOWLEDGE_LIMITS.locations * 2).nullish(),
  locationRole: z.enum(LOCATION_ROLES).nullish(),
  validUntil: z.string().trim().min(1).nullish(),
  aiEnabled: z.boolean().default(true),
});

/** Who changed the library, as the activity log names it. */
const actorFor = (agent: { name: string }) => `agent:${agent.name}`;

/**
 * Add an entry, or replace one (`id`). The same checks as the library
 * page: this workspace's cars only, the three kinds, the size limits.
 *
 * A whole entry, not a patch: an agent that edits sends back what it
 * read, so a field it left out is not silently kept from before.
 *
 * Its own scope, apart from orders and messages: what this changes is
 * what TATO's AI tells guests, so a token gets it only on purpose.
 * Every change is logged with the token's name.
 */
export async function POST(request: Request) {
  const agent = await authenticateAgent(request, "templates:write");
  if (!agent) return withCors({ error: "UNAUTHORIZED" }, { status: 401 });

  const parsed = saveSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return withCors({ error: "VALIDATION_ERROR", issues: parsed.error.issues.slice(0, 5) }, { status: 400 });
  }
  const before = parsed.data.id
    ? await prisma.messageTemplate.findFirst({
        where: { id: parsed.data.id, workspaceId: agent.workspaceId },
        select: { label: true, content: true },
      })
    : null;

  const result = await saveKnowledge(agent.workspaceId, {
    ...parsed.data,
    id: parsed.data.id ?? null,
    vehicleIds: parsed.data.vehicleIds ?? null,
    stages: parsed.data.stages ?? null,
    locations: parsed.data.locations ?? null,
    validUntil: parsed.data.validUntil ?? null,
  });
  if (!result.ok) {
    return withCors({ error: result.error }, { status: result.error === "NOT_FOUND" ? 404 : 400 });
  }

  await logActivity({
    workspaceId: agent.workspaceId,
    actor: actorFor(agent),
    action: parsed.data.id ? "message_template_updated" : "message_template_created",
    entityType: "MessageTemplate",
    entityId: result.entry.id,
    // The previous wording, so a bad edit can be put back by hand.
    metadata: { label: result.entry.label, before },
  }).catch(() => null);

  const vehicles = new Map((await loadVehicleLabels(agent.workspaceId)).map((vehicle) => [vehicle.id, vehicle]));
  return withCors({ entry: shape(result.entry, vehicles), usage: USAGE });
}

export async function DELETE(request: Request) {
  const agent = await authenticateAgent(request, "templates:write");
  if (!agent) return withCors({ error: "UNAUTHORIZED" }, { status: 401 });

  const parsed = z.object({ id: z.string().trim().min(1) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return withCors({ error: "VALIDATION_ERROR" }, { status: 400 });

  const before = await prisma.messageTemplate.findFirst({
    where: { id: parsed.data.id, workspaceId: agent.workspaceId },
    select: { label: true, content: true, kind: true },
  });
  if (!before || !(await deleteKnowledge(agent.workspaceId, parsed.data.id))) {
    return withCors({ error: "NOT_FOUND" }, { status: 404 });
  }

  await logActivity({
    workspaceId: agent.workspaceId,
    actor: actorFor(agent),
    action: "message_template_deleted",
    entityType: "MessageTemplate",
    entityId: parsed.data.id,
    metadata: { label: before.label, before },
  }).catch(() => null);

  return withCors({ ok: true });
}

export function OPTIONS() {
  return corsPreflight();
}
