import "server-only";

import {
  buildKnowledgeBlock,
  KNOWLEDGE_KINDS,
  toKnowledgeEntry,
  TRIP_STAGES,
  tripStageAt,
  type KnowledgeKind,
  type LocationRole,
  type TripStage,
} from "@/lib/message-knowledge";
import { prisma } from "@/lib/prisma";

/**
 * The AI message library on the server: storage, and the library
 * section of a prompt for one conversation. The rules about what the AI
 * may see are in lib/message-knowledge.ts, shared with the page.
 */

export const KNOWLEDGE_LIMITS = {
  label: 80,
  content: 4000,
  triggers: 20,
  triggerLength: 200,
  locations: 10,
  locationLength: 60,
  entries: 500,
} as const;

const SELECT = {
  id: true,
  label: true,
  content: true,
  kind: true,
  triggers: true,
  vehicleId: true,
  vehicleIds: true,
  stages: true,
  locations: true,
  locationRole: true,
  validUntil: true,
  aiEnabled: true,
  updatedAt: true,
} as const;

export async function loadKnowledge(workspaceId: string) {
  const rows = await prisma.messageTemplate.findMany({
    where: { workspaceId },
    orderBy: [{ updatedAt: "desc" }],
    select: SELECT,
    take: KNOWLEDGE_LIMITS.entries,
  });
  return rows.map(toKnowledgeEntry);
}

/** "SD101B · Toyota Sienna 2022", the name a car goes by everywhere a
 *  plate has to settle which one. */
export async function loadVehicleLabels(workspaceId: string) {
  const vehicles = await prisma.vehicle.findMany({
    where: { workspaceId, isArchived: false },
    select: { id: true, plateNumber: true, brand: true, model: true, year: true, nickname: true },
    orderBy: { plateNumber: "asc" },
  });
  return vehicles.map((vehicle) => ({
    id: vehicle.id,
    label: `${vehicle.plateNumber} · ${vehicle.brand} ${vehicle.model} ${vehicle.year}`,
    nickname: vehicle.nickname,
  }));
}

export type KnowledgeInput = {
  id?: string | null;
  label: string;
  content: string;
  kind: KnowledgeKind;
  triggers: string[];
  vehicleIds: string[] | null;
  stages: TripStage[] | null;
  locations: string[] | null;
  locationRole?: LocationRole | null;
  validUntil: string | null;
  aiEnabled: boolean;
};

export async function saveKnowledge(workspaceId: string, input: KnowledgeInput) {
  const label = input.label.trim().slice(0, KNOWLEDGE_LIMITS.label);
  const content = input.content.trim().slice(0, KNOWLEDGE_LIMITS.content);
  if (!label) return { ok: false as const, error: "LABEL_REQUIRED" };
  if (!content) return { ok: false as const, error: "CONTENT_REQUIRED" };
  if (!(KNOWLEDGE_KINDS as readonly string[]).includes(input.kind)) return { ok: false as const, error: "BAD_KIND" };

  const triggers = [...new Set(input.triggers.map((line) => line.trim().slice(0, KNOWLEDGE_LIMITS.triggerLength)).filter(Boolean))]
    .slice(0, KNOWLEDGE_LIMITS.triggers);
  const stages = (input.stages ?? []).filter((stage) => (TRIP_STAGES as readonly string[]).includes(stage));
  const locations = [
    ...new Set((input.locations ?? []).map((word) => word.trim().slice(0, KNOWLEDGE_LIMITS.locationLength)).filter(Boolean)),
  ].slice(0, KNOWLEDGE_LIMITS.locations);

  // Only this workspace's cars: an id from elsewhere would scope an
  // entry to a car nobody here can see, which reads as "no car".
  let vehicleIds: string[] = [];
  if (input.vehicleIds && input.vehicleIds.length > 0) {
    const owned = await prisma.vehicle.findMany({
      where: { workspaceId, id: { in: input.vehicleIds } },
      select: { id: true },
    });
    vehicleIds = owned.map((vehicle) => vehicle.id);
    if (vehicleIds.length === 0) return { ok: false as const, error: "VEHICLE_NOT_FOUND" };
  }

  const validUntil = input.validUntil ? new Date(input.validUntil) : null;
  if (validUntil && Number.isNaN(validUntil.getTime())) return { ok: false as const, error: "BAD_DATE" };

  const data = {
    label,
    content,
    kind: input.kind,
    triggers: triggers.length > 0 ? triggers.join("\n") : null,
    vehicleIds: vehicleIds.length > 0 ? JSON.stringify(vehicleIds) : null,
    // Kept in step for anything still reading the single-car column:
    // the old template picker and the outside agent's filter.
    vehicleId: vehicleIds.length === 1 ? vehicleIds[0] : null,
    stages: stages.length > 0 && stages.length < TRIP_STAGES.length ? JSON.stringify(stages) : null,
    locations: locations.length > 0 ? JSON.stringify(locations) : null,
    locationRole: input.locationRole ?? null,
    validUntil,
    aiEnabled: input.aiEnabled,
  };

  if (input.id) {
    const existing = await prisma.messageTemplate.findFirst({
      where: { id: input.id, workspaceId },
      select: { id: true },
    });
    if (!existing) return { ok: false as const, error: "NOT_FOUND" };
    const row = await prisma.messageTemplate.update({ where: { id: existing.id }, data, select: SELECT });
    return { ok: true as const, entry: toKnowledgeEntry(row) };
  }

  const count = await prisma.messageTemplate.count({ where: { workspaceId } });
  if (count >= KNOWLEDGE_LIMITS.entries) return { ok: false as const, error: "LIBRARY_FULL" };
  const row = await prisma.messageTemplate.create({ data: { workspaceId, ...data }, select: SELECT });
  return { ok: true as const, entry: toKnowledgeEntry(row) };
}

/** Whether there was such an entry to delete. */
export async function deleteKnowledge(workspaceId: string, id: string) {
  // Scheduled-message rules point at templates; a rule whose template
  // is gone simply stops producing messages (see listDueMessages).
  const { count } = await prisma.messageTemplate.deleteMany({ where: { workspaceId, id } });
  return count > 0;
}

type TripForKnowledge = {
  renterName: string;
  pickupDatetime: Date;
  returnDatetime: Date;
  pickupLocation: string | null;
  returnLocation: string | null;
  externalOrderId: string | null;
  vehicle?: { plateNumber: string; brand: string; model: string; year: number } | null;
} | null;

/**
 * The library section of a prompt for one conversation.
 *
 * The pickup code is not put in the placeholder context: see
 * buildKnowledgeBlock. Everything else the trip knows is.
 */
export async function knowledgeForConversation(input: {
  workspaceId: string;
  vehicleId: string | null;
  trip: TripForKnowledge;
  guestName: string | null;
  question: string;
  now?: Date;
}) {
  const [entries, vehicles] = await Promise.all([
    loadKnowledge(input.workspaceId),
    loadVehicleLabels(input.workspaceId),
  ]);
  const trip = input.trip;
  return buildKnowledgeBlock({
    entries,
    scope: {
      vehicleId: input.vehicleId,
      stage: tripStageAt(trip ? { pickup: trip.pickupDatetime, return: trip.returnDatetime } : null, input.now),
      pickupLocation: trip?.pickupLocation ?? null,
      returnLocation: trip?.returnLocation ?? null,
      now: input.now,
    },
    question: input.question,
    context: {
      guest: input.guestName ?? trip?.renterName ?? null,
      car: trip?.vehicle ? `${trip.vehicle.brand} ${trip.vehicle.model} ${trip.vehicle.year}` : null,
      plate: trip?.vehicle?.plateNumber ?? null,
      pickup: trip?.pickupDatetime ?? null,
      return: trip?.returnDatetime ?? null,
      pickupLocation: trip?.pickupLocation ?? null,
      returnLocation: trip?.returnLocation ?? null,
      reservation: trip?.externalOrderId ?? null,
    },
    vehicleLabels: Object.fromEntries(vehicles.map((vehicle) => [vehicle.id, vehicle.label])),
  });
}
