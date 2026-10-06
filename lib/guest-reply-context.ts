import "server-only";

import { prisma } from "@/lib/prisma";

/**
 * What a guest-reply draft can learn from besides the thread itself.
 *
 * - How this host has answered similar questions before: (guest asked,
 *   host answered) pairs taken from recorded conversations, ranked by
 *   how many words they share with the question being answered, the
 *   same car first. They teach tone and what is usually said -- not
 *   facts: an old answer's code, address or time may no longer hold,
 *   and the prompt says so.
 * - What the operator has written down about this car for guests.
 */

const PAIR_SCAN_LIMIT = 1500;
const PAIRS_RETURNED = 3;
const PAIR_TEXT_CHARS = 300;

const STOPWORDS = new Set(
  "the a an and or to of in on at for is are was be it i you we my your our me us this that with can will do does have has just so if not no yes ok okay hi hello thanks thank please there here what when where how".split(
    " ",
  ),
);

function words(value: string) {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9㐀-鿿]+/)
      .filter((word) => word.length > 2 && !STOPWORDS.has(word)),
  );
}

export type ReplyPair = { asked: string; answered: string; sameCar: boolean };

/**
 * The host's past answers most like this question. Empty when nothing
 * has been recorded yet -- the reader or an agent records conversations;
 * mail never carries the host's side.
 */
export async function findSimilarPastReplies(input: {
  workspaceId: string;
  question: string;
  vehicleId: string | null;
  /** This conversation's own reservation, left out: its answers are
   *  already in the transcript. */
  excludeReservationId?: string | null;
}): Promise<ReplyPair[]> {
  const asked = words(input.question);
  if (asked.size === 0) return [];

  const rows = await prisma.turoConversationMessage.findMany({
    where: {
      workspaceId: input.workspaceId,
      ...(input.excludeReservationId ? { reservationId: { not: input.excludeReservationId } } : {}),
    },
    orderBy: [{ reservationId: "asc" }, { sentAt: "asc" }],
    take: PAIR_SCAN_LIMIT,
    select: { reservationId: true, direction: true, body: true },
  });

  const reservationIds = [...new Set(rows.map((row) => row.reservationId))];
  const orders = reservationIds.length
    ? await prisma.order.findMany({
        where: { workspaceId: input.workspaceId, externalOrderId: { in: reservationIds } },
        select: { externalOrderId: true, vehicleId: true },
      })
    : [];
  const vehicleByReservation = new Map(orders.map((order) => [order.externalOrderId, order.vehicleId]));

  // A guest message followed, in the same conversation, by our reply.
  const pairs: (ReplyPair & { score: number })[] = [];
  for (let i = 0; i < rows.length - 1; i += 1) {
    const guest = rows[i];
    const host = rows[i + 1];
    if (guest.direction !== "inbound" || host.direction !== "outbound") continue;
    if (guest.reservationId !== host.reservationId) continue;
    const shared = [...words(guest.body)].filter((word) => asked.has(word)).length;
    if (shared === 0) continue;
    const sameCar = Boolean(input.vehicleId) && vehicleByReservation.get(guest.reservationId) === input.vehicleId;
    pairs.push({
      asked: guest.body.slice(0, PAIR_TEXT_CHARS),
      answered: host.body.slice(0, PAIR_TEXT_CHARS),
      sameCar,
      // Same car counts as a shared word and a half: its answers are
      // the likeliest still to be true.
      score: shared + (sameCar ? 1.5 : 0),
    });
  }

  return pairs
    .sort((a, b) => b.score - a.score)
    .slice(0, PAIRS_RETURNED)
    .map(({ asked: q, answered, sameCar }) => ({ asked: q, answered, sameCar }));
}

export async function getVehicleReplyKnowledge(workspaceId: string, vehicleId: string | null) {
  if (!vehicleId) return null;
  const row = await prisma.vehicleReplyKnowledge.findFirst({
    where: { workspaceId, vehicleId },
    select: { content: true },
  });
  return row?.content.trim() || null;
}

export const VEHICLE_KNOWLEDGE_MAX_CHARS = 1500;

export async function saveVehicleReplyKnowledge(input: { workspaceId: string; vehicleId: string; content: string }) {
  const vehicle = await prisma.vehicle.findFirst({
    where: { id: input.vehicleId, workspaceId: input.workspaceId },
    select: { id: true },
  });
  if (!vehicle) return { ok: false as const, error: "NOT_FOUND" };
  const content = input.content.trim().slice(0, VEHICLE_KNOWLEDGE_MAX_CHARS);
  if (!content) {
    await prisma.vehicleReplyKnowledge.deleteMany({ where: { workspaceId: input.workspaceId, vehicleId: vehicle.id } });
    return { ok: true as const };
  }
  await prisma.vehicleReplyKnowledge.upsert({
    where: { vehicleId: vehicle.id },
    create: { workspaceId: input.workspaceId, vehicleId: vehicle.id, content },
    update: { content },
  });
  return { ok: true as const };
}
