import { NextResponse } from "next/server";
import { z } from "zod";

import { askAssistant } from "@/lib/assistant";
import { requireCurrentAdminContext } from "@/lib/auth";
import { isKimiConfigured } from "@/lib/kimi";
import { prisma } from "@/lib/prisma";
import { checkRateLimit, getClientIp, recordFailedAttempt } from "@/lib/rate-limit";

export const runtime = "nodejs";

// Each question costs a model call. Bound it so a stuck client loop or
// a bored user can't run up the bill — 60 questions in 10 minutes is
// far more than a person asks and far less than a runaway loop sends.
const ASSISTANT_LIMIT = 60;
const ASSISTANT_WINDOW_MS = 10 * 60 * 1000;

const chatSchema = z.object({
  // `.nullish()`, not `.optional()`. The composer holds the current
  // thread in React state initialised to `null`, and JSON.stringify
  // sends that as `null` rather than dropping the key — which a bare
  // `.optional()` rejects. That rejected every first message in a new
  // thread, and since the thread is only created once a message
  // validates, the assistant could never get past its own first
  // question. Accept both spellings of "no thread yet".
  threadId: z.string().trim().min(1).nullish(),
  message: z.string().trim().min(1).max(4000),
});

export async function POST(request: Request) {
  let context;
  try {
    context = await requireCurrentAdminContext();
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  if (!isKimiConfigured()) {
    return NextResponse.json(
      { error: "ASSISTANT_NOT_CONFIGURED" },
      { status: 503 },
    );
  }

  const parsed = chatSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });
  }

  const ip = await getClientIp();
  const decision = await checkRateLimit({
    scope: "assistant_chat",
    identifier: `${context.workspace.id}:${ip}`,
    maxAttempts: ASSISTANT_LIMIT,
    windowMs: ASSISTANT_WINDOW_MS,
  });
  if (!decision.allowed) {
    return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
  }

  // Resolve the thread, scoped to this workspace and user. A threadId
  // from another workspace resolves to null and starts a fresh thread
  // rather than leaking that workspace's conversation.
  let thread = parsed.data.threadId
    ? await prisma.assistantThread.findFirst({
        where: {
          id: parsed.data.threadId,
          workspaceId: context.workspace.id,
          userId: context.user.id,
        },
      })
    : null;

  if (!thread) {
    thread = await prisma.assistantThread.create({
      data: {
        workspaceId: context.workspace.id,
        userId: context.user.id,
        title: parsed.data.message.slice(0, 80),
      },
    });
  }

  const history = await prisma.assistantMessage.findMany({
    where: { threadId: thread.id },
    orderBy: { createdAt: "asc" },
    take: 24,
    select: { role: true, content: true },
  });

  await prisma.assistantMessage.create({
    data: { threadId: thread.id, role: "USER", content: parsed.data.message },
  });

  const reply = await askAssistant({
    workspaceId: context.workspace.id,
    operatorName: context.user.name,
    question: parsed.data.message,
    history,
  });

  await recordFailedAttempt({
    scope: "assistant_chat",
    identifier: `${context.workspace.id}:${ip}`,
    windowMs: ASSISTANT_WINDOW_MS,
  });

  if (!reply.ok) {
    return NextResponse.json(
      { error: "ASSISTANT_FAILED", reason: reply.reason, threadId: thread.id },
      { status: 502 },
    );
  }

  const saved = await prisma.assistantMessage.create({
    data: {
      threadId: thread.id,
      role: "ASSISTANT",
      content: reply.content,
      context: JSON.stringify(reply.snapshot.summary),
    },
  });

  await prisma.assistantThread.update({
    where: { id: thread.id },
    data: { updatedAt: new Date() },
  });

  return NextResponse.json({
    threadId: thread.id,
    message: {
      id: saved.id,
      role: "ASSISTANT",
      content: reply.content,
      createdAt: saved.createdAt.toISOString(),
    },
    snapshot: reply.snapshot.summary,
  });
}
