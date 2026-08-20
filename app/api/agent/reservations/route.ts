import { NextResponse } from "next/server";

import { corsPreflight, withCors } from "@/lib/agent-cors";

import { authenticateAgent } from "@/lib/agent-auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

/**
 * Which conversations the agent should read.
 *
 * TATO already knows every reservation the mailbox has seen, so the
 * agent does not have to crawl a list page to discover them -- one
 * fewer page of Turo's markup to depend on, and one fewer thing to
 * break when they redesign.
 *
 * Ordered by the most recent guest message, because a conversation
 * that moved today is the one whose missing half matters. Trips that
 * ended long ago are not worth a page load.
 */
export async function GET(request: Request) {
  const agent = await authenticateAgent(request, "messages:write");
  if (!agent) {
    return withCors({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const url = new URL(request.url);
  const requested = Number.parseInt(url.searchParams.get("limit") ?? "20", 10);
  const limit = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), 100) : 20;

  // Ordered by the newest guest message, not by trip date.
  //
  // The first version ordered by `pickupDatetime desc`, which returns
  // the trips starting furthest in the future -- the opposite end of
  // the fleet from the conversations anyone is reading. Measured after
  // the first real run: three of the twelve threads at the top of the
  // messages page had been read, and the rest of the run went to trips
  // nobody had messaged about yet.
  //
  // A conversation is worth opening because it moved, so the ordering
  // follows the mail. Queried over emails rather than orders because
  // that is where the timestamps are.
  const recent = await prisma.inboundEmail.findMany({
    where: {
      workspaceId: agent.workspaceId,
      kind: { in: ["GUEST_MESSAGE", "SUPPORT"] },
      order: { isNot: null },
    },
    orderBy: { receivedAt: "desc" },
    // Over-fetch: several messages usually share one reservation, so
    // taking `limit` rows would yield far fewer than `limit` distinct
    // conversations.
    take: limit * 8,
    select: { order: { select: { externalOrderId: true } } },
  });

  const seen = new Set<string>();
  const reservationIds: string[] = [];
  for (const row of recent) {
    const id = row.order?.externalOrderId;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    reservationIds.push(id);
    if (reservationIds.length >= limit) break;
  }

  return withCors({ reservationIds });
}

export function OPTIONS() {
  return corsPreflight();
}
