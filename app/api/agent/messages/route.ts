import { NextResponse } from "next/server";
import { z } from "zod";

import { authenticateAgent, messageFingerprint } from "@/lib/agent-auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

/**
 * Conversation messages, pushed by the browser agent.
 *
 * This exists for one thing the mailbox structurally cannot provide:
 * what we said. Turo emails a notification when a guest writes and
 * sends nothing when the host replies, so every conversation in this
 * system has been one-sided -- which is why the unanswered count runs
 * high and why a drafted reply cannot see whether the same question
 * was already answered an hour ago.
 *
 * Idempotent on (workspace, reservation, externalId). Re-scraping a
 * conversation updates in place, so the agent can re-read a thread
 * whenever it likes without accumulating duplicates.
 */
const messageSchema = z.object({
  /** Turo's id for the message, when the page exposes one. Omitted
   *  falls back to a content fingerprint. */
  externalId: z.string().trim().max(120).optional(),
  direction: z.enum(["inbound", "outbound"]),
  authorName: z.string().trim().max(120).nullish(),
  body: z.string().trim().min(1).max(8000),
  sentAt: z.string().datetime(),
});

const payloadSchema = z.object({
  reservationId: z.string().trim().min(1).max(40),
  /** Which agent run this came from, for tracing a bad scrape back. */
  source: z.string().trim().max(120).optional(),
  messages: z.array(messageSchema).min(1).max(200),
});

export async function POST(request: Request) {
  const agent = await authenticateAgent(request, "messages:write");
  if (!agent) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const parsed = payloadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION_ERROR", detail: parsed.error.issues.slice(0, 3) },
      { status: 400 },
    );
  }

  const { reservationId, messages, source } = parsed.data;

  let written = 0;
  let updated = 0;

  for (const message of messages) {
    const externalId =
      message.externalId ||
      messageFingerprint({
        direction: message.direction,
        sentAt: message.sentAt,
        body: message.body,
      });

    const existing = await prisma.turoConversationMessage.findUnique({
      where: {
        workspaceId_reservationId_externalId: {
          workspaceId: agent.workspaceId,
          reservationId,
          externalId,
        },
      },
      select: { id: true, body: true },
    });

    if (existing) {
      // Only rewrite when the text actually moved. An unchanged row
      // rewritten on every scrape would churn the table and make
      // `createdAt` useless for spotting when something appeared.
      if (existing.body !== message.body) {
        await prisma.turoConversationMessage.update({
          where: { id: existing.id },
          data: { body: message.body, bodyZh: null, source: source ?? null },
        });
        updated += 1;
      }
      continue;
    }

    await prisma.turoConversationMessage.create({
      data: {
        workspaceId: agent.workspaceId,
        reservationId,
        externalId,
        direction: message.direction,
        authorName: message.authorName ?? null,
        body: message.body,
        sentAt: new Date(message.sentAt),
        source: source ?? null,
      },
    });
    written += 1;
  }

  // eslint-disable-next-line no-console
  console.log(
    `[agent] ${agent.name} :: reservation=${reservationId} created=${written} updated=${updated}`,
  );

  return NextResponse.json({ ok: true, reservationId, created: written, updated });
}
