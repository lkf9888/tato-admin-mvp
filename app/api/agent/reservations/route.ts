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

  const orders = await prisma.order.findMany({
    where: {
      workspaceId: agent.workspaceId,
      isArchived: false,
      externalOrderId: { not: null },
      // Anything still live, or that ended within the fortnight: a
      // guest asking about a deposit two days after returning the car
      // is still a conversation someone has to answer.
      returnDatetime: { gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) },
      inboundEmails: { some: { kind: { in: ["GUEST_MESSAGE", "SUPPORT"] } } },
    },
    orderBy: { pickupDatetime: "desc" },
    take: limit,
    select: { externalOrderId: true },
  });

  return withCors({
    reservationIds: orders
      .map((order) => order.externalOrderId)
      .filter((id): id is string => !!id),
  });
}

export function OPTIONS() {
  return corsPreflight();
}
