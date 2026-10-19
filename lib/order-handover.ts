import { z } from "zod";

import { logActivity } from "@/lib/orders";
import { prisma } from "@/lib/prisma";

/**
 * Where a trip's car is handed over: the exact pickup spot, the return
 * spot, and how to get in (where the lockbox is, landmarks). About a
 * third of guests' messages ask some form of "where is the car" or "the
 * lockbox won't open"; general rules in the message library cannot
 * answer that, only this trip's own details can.
 *
 * Saved from the order panel and from a staff member's task page, by
 * this one function, so both write the same thing the same way. The
 * lockbox code is not one of these fields and must not be typed into
 * them: it has its own field and stays out of anything the AI reads.
 */

const text = (max: number) =>
  z.preprocess(
    (value) => (typeof value === "string" ? value.trim() : value),
    z.string().max(max).nullable().optional(),
  );

export const handoverInputSchema = z.object({
  pickupSpot: text(200),
  returnSpot: text(200),
  handoverNote: text(1000),
});

export type HandoverInput = z.infer<typeof handoverInputSchema>;
export type Handover = { pickupSpot: string | null; returnSpot: string | null; handoverNote: string | null };

/** Only the fields sent are changed; an empty one is cleared. */
export async function saveOrderHandover(input: {
  orderId: string;
  workspaceId: string;
  actor: string;
  values: HandoverInput;
}): Promise<Handover> {
  const data: Partial<Handover> = {};
  for (const key of ["pickupSpot", "returnSpot", "handoverNote"] as const) {
    if (input.values[key] !== undefined) data[key] = input.values[key] || null;
  }
  const order = await prisma.order.update({
    where: { id: input.orderId },
    data,
    select: { pickupSpot: true, returnSpot: true, handoverNote: true },
  });
  await logActivity({
    workspaceId: input.workspaceId,
    actor: input.actor,
    action: "order_handover_updated",
    entityType: "Order",
    entityId: input.orderId,
    metadata: data,
  });
  return order;
}
