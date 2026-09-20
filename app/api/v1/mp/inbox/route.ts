import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { resolveFieldLabels } from "@/lib/notify-hub/labels";
import { authenticateSubscriber } from "@/lib/notify-hub/session";

export const runtime = "nodejs";

/**
 * What a tapped message opens, and the short list behind it.
 *
 * A subscribe message has room for a title and four values, so the
 * detail screen has to come from somewhere -- and it cannot come from
 * the sending system, because one of them is a machine in a car park
 * with no public address. This returns the small payload the hub kept
 * for exactly that, and nothing more: no history, no read state, no
 * search. Rows age out on their own.
 */

const MAX_ITEMS = 50;

function parsePayload(raw: string) {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const subscriber = authenticateSubscriber(request);
  if (!subscriber) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const deliveryId = request.nextUrl.searchParams.get("d")?.trim();
  const now = new Date();

  // Scoped by openid in the query rather than checked afterwards: the
  // id arrives from a tapped message and is the only thing the caller
  // controls, so it must not be able to name someone else's row.
  const deliveries = await prisma.notifyDelivery.findMany({
    where: {
      openId: subscriber.openId,
      expiresAt: { gt: now },
      channel: { app: { miniProgramId: subscriber.miniProgramId } },
      ...(deliveryId ? { id: deliveryId } : {}),
    },
    include: { channel: { include: { app: { select: { key: true, name: true, fieldLabels: true } } } } },
    orderBy: { createdAt: "desc" },
    take: deliveryId ? 1 : MAX_ITEMS,
  });

  const items = deliveries.map((delivery) => ({
    id: delivery.id,
    appKey: delivery.channel.app.key,
    appName: delivery.channel.app.name,
    channelName: delivery.channel.name,
    template: delivery.templateKey,
    priority: delivery.priority,
    status: delivery.status,
    payload: parsePayload(delivery.payload),
    link: delivery.page ? parsePayload(delivery.page) : null,
    createdAt: delivery.createdAt.toISOString(),
  }));

  // Labels ride at the response level, keyed by app, rather than on each
  // item: one map per app beats the same map repeated fifty times, and
  // the client already knows which app each item came from.
  const labels: Record<string, Record<string, string>> = {};
  for (const delivery of deliveries) {
    const appKey = delivery.channel.app.key;
    if (!labels[appKey]) {
      labels[appKey] = resolveFieldLabels(delivery.channel.app.fieldLabels);
    }
  }

  if (deliveryId) {
    const item = items[0];
    if (!item) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    return NextResponse.json({ item, labels });
  }

  return NextResponse.json({ items, labels });
}
