import "server-only";

import { prisma } from "@/lib/prisma";

/**
 * The orders a person opened last -- from the dashboard, the calendar
 * or an order's page -- so the dashboard can put them back in reach.
 * Kept per person on the server rather than in the browser, since the
 * same person moves between a laptop and a phone.
 */

const KEEP = 20;

/** Note that this person opened this order. Silently ignores an order not on their workspace or cars. */
export async function rememberOrderView(input: {
  workspaceId: string;
  userId: string;
  orderId: string;
  vehicleIds?: string[] | null;
}) {
  const order = await prisma.order.findFirst({
    where: {
      id: input.orderId,
      workspaceId: input.workspaceId,
      ...(input.vehicleIds ? { vehicleId: { in: input.vehicleIds } } : {}),
    },
    select: { id: true },
  });
  if (!order) return false;
  const id = `${input.userId}:${order.id}`;
  const viewedAt = new Date();
  await prisma.orderView.upsert({
    where: { id },
    update: { viewedAt },
    create: { id, workspaceId: input.workspaceId, userId: input.userId, orderId: order.id, viewedAt },
  });
  // Only the last few matter; trim the rest now and then rather than on every view.
  if (Math.random() < 0.1) {
    const stale = await prisma.orderView.findMany({
      where: { userId: input.userId },
      orderBy: { viewedAt: "desc" },
      skip: KEEP,
      select: { id: true },
    });
    if (stale.length) await prisma.orderView.deleteMany({ where: { id: { in: stale.map((row) => row.id) } } });
  }
  return true;
}

/** This person's last `take` opened orders still live on their workspace (and cars), newest first. */
export async function recentOrderViews(input: {
  workspaceId: string;
  userId: string;
  vehicleIds?: string[] | null;
  take?: number;
}) {
  const take = input.take ?? 3;
  const views = await prisma.orderView.findMany({
    where: { userId: input.userId, workspaceId: input.workspaceId },
    orderBy: { viewedAt: "desc" },
    take: take + 7,
    select: { orderId: true, viewedAt: true },
  });
  if (views.length === 0) return [];
  const orders = await prisma.order.findMany({
    where: {
      id: { in: views.map((view) => view.orderId) },
      workspaceId: input.workspaceId,
      isArchived: false,
      ...(input.vehicleIds ? { vehicleId: { in: input.vehicleIds } } : {}),
    },
    include: { vehicle: true },
  });
  const byId = new Map(orders.map((order) => [order.id, order]));
  return views
    .map((view) => byId.get(view.orderId))
    .filter((order): order is NonNullable<typeof order> => Boolean(order))
    .slice(0, take);
}
