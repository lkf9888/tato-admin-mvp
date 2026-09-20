import "server-only";

import { prisma } from "@/lib/prisma";

/**
 * Subscribe-message quota.
 *
 * WeChat's one-off subscription is the constraint the whole hub is
 * shaped around: one authorisation buys exactly one message, and
 * authorisations accumulate. The server cannot ask how many a person
 * has left -- there is no such endpoint -- so it has to count, adding
 * when the mini program reports a grant and subtracting when a send
 * succeeds.
 *
 * The count can drift: a person may authorise in a session that never
 * reaches us, or WeChat may expire a grant. Drift in our favour costs
 * a wasted call that comes back 43101, which zeroes the row and
 * corrects it. Drift against us costs an unsent message until the next
 * grant. Neither is silent, which is the property that matters.
 */

export type Priority = "high" | "normal" | "low";

/**
 * How much must be left before a message of this priority may spend.
 *
 * Quota is per person and per template, so a shared template means a
 * wash-bay "photos uploaded" can eat the slot a TATO "handover in 30
 * minutes" needed an hour later. Reserving the last slots for urgent
 * messages is the cheapest way to stop routine traffic crowding out
 * the traffic the channel exists for.
 */
const FLOOR: Record<Priority, number> = {
  high: 1,
  normal: 2,
  low: 3,
};

export async function grantQuota(input: {
  miniProgramId: string;
  openId: string;
  templateKeys: string[];
}) {
  const now = new Date();
  const results: Record<string, number> = {};

  for (const templateKey of input.templateKeys) {
    const row = await prisma.notifySubscribeQuota.upsert({
      where: {
        miniProgramId_openId_templateKey: {
          miniProgramId: input.miniProgramId,
          openId: input.openId,
          templateKey,
        },
      },
      create: {
        miniProgramId: input.miniProgramId,
        openId: input.openId,
        templateKey,
        remaining: 1,
        lastGrantedAt: now,
      },
      update: {
        remaining: { increment: 1 },
        lastGrantedAt: now,
      },
    });
    results[templateKey] = row.remaining;
  }

  return results;
}

export async function getQuota(input: {
  miniProgramId: string;
  openId: string;
  templateKeys: string[];
}) {
  const rows = await prisma.notifySubscribeQuota.findMany({
    where: {
      miniProgramId: input.miniProgramId,
      openId: input.openId,
      templateKey: { in: input.templateKeys },
    },
  });

  const byKey: Record<string, number> = {};
  for (const key of input.templateKeys) byKey[key] = 0;
  for (const row of rows) byKey[row.templateKey] = row.remaining;
  return byKey;
}

/**
 * Take a slot if the priority's floor allows it.
 *
 * Spends before sending rather than after. A send that fails leaves
 * the slot spent until the next 43101 or grant corrects it, which is
 * the right way round: two processes handling a duplicate task update
 * must not both decide there is one slot left and both send.
 */
export async function spendQuota(input: {
  miniProgramId: string;
  openId: string;
  templateKey: string;
  priority: Priority;
}): Promise<boolean> {
  const floor = FLOOR[input.priority];

  // Conditional decrement: the `gte` is the whole guard, and it is
  // evaluated by the database rather than by us, so two concurrent
  // sends cannot both read the same remaining count.
  const updated = await prisma.notifySubscribeQuota.updateMany({
    where: {
      miniProgramId: input.miniProgramId,
      openId: input.openId,
      templateKey: input.templateKey,
      remaining: { gte: floor },
    },
    data: {
      remaining: { decrement: 1 },
      lastSpentAt: new Date(),
    },
  });

  return updated.count > 0;
}

/** Hand a slot back when the send failed for a reason a retry could fix. */
export async function refundQuota(input: {
  miniProgramId: string;
  openId: string;
  templateKey: string;
}) {
  await prisma.notifySubscribeQuota
    .updateMany({
      where: {
        miniProgramId: input.miniProgramId,
        openId: input.openId,
        templateKey: input.templateKey,
      },
      data: { remaining: { increment: 1 } },
    })
    .catch(() => null);
}

/**
 * WeChat says there is nothing left. Believe it over our own count.
 */
export async function clearQuota(input: {
  miniProgramId: string;
  openId: string;
  templateKey: string;
}) {
  await prisma.notifySubscribeQuota
    .updateMany({
      where: {
        miniProgramId: input.miniProgramId,
        openId: input.openId,
        templateKey: input.templateKey,
      },
      data: { remaining: 0 },
    })
    .catch(() => null);
}
