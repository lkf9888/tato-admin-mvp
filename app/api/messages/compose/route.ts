import { NextResponse } from "next/server";
import { z } from "zod";

import { requireCurrentAdminContext } from "@/lib/auth";
import { loadReplyContext, replyContextText, REPLY_RULES } from "@/lib/guest-reply-prompt";
import { isKimiConfigured, kimiChat } from "@/lib/kimi";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

const composeSchema = z.object({
  mode: z.enum(["rewrite", "translate"]),
  /** What is in the composer: the host's shorthand (rewrite) or a
   *  finished message (translate). */
  text: z.string().trim().min(1).max(4000),
  emailIds: z.array(z.string().trim().min(1)).min(1).max(60),
  guestName: z.string().trim().min(1).max(200),
  vehicleId: z.string().trim().min(1).nullish(),
});

const REWRITE_PROMPT = [
  "You write messages for a Turo host to send to a guest.",
  "The host has written what they want to say, often as Chinese shorthand (e.g. 问客人取车顺不顺利). Write the message they meant, ready to send.",
  "Say what the host asked to say -- nothing more, nothing less. Facts the host states win over everything else; take any other fact only from the trip facts or the library.",
  REPLY_RULES,
].join("\n");

const TRANSLATE_PROMPT = [
  "You translate a message a Turo host is about to send to a guest.",
  "Translate it into the language the guest writes in (their latest message is given). If the message is already in that language, return it unchanged.",
  "Keep the meaning, tone and length. Keep names, times, dates, prices, plates, codes, addresses, links and {{placeholders}} exactly as written. Do not add or remove anything.",
  "Output only the translated message.",
].join("\n");

/**
 * The composer's 改写 and 翻译: the host's words in, a message ready
 * for Turo out. Neither sends anything; the page copies the result and
 * opens the Turo conversation.
 *
 * Rewrite reads the whole reply context (trip, library, memory, the
 * conversation) so the message lands in the conversation rather than
 * beside it. Translate reads only the guest's latest message, for the
 * language -- it must not change what the host decided to say.
 */
export async function POST(request: Request) {
  let context;
  try {
    context = await requireCurrentAdminContext();
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (!isKimiConfigured()) return NextResponse.json({ error: "ASSISTANT_NOT_CONFIGURED" }, { status: 503 });

  const parsed = composeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });

  const ip = await getClientIp();
  const decision = await checkRateLimit({
    scope: "message_compose",
    identifier: `${context.workspace.id}:${ip}`,
    maxAttempts: 60,
    windowMs: 10 * 60 * 1000,
  });
  if (!decision.allowed) return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });

  const reply = await loadReplyContext({
    workspaceId: context.workspace.id,
    emailIds: parsed.data.emailIds,
    guestName: parsed.data.guestName,
    vehicleId: parsed.data.vehicleId ?? null,
  });
  if (!reply) return NextResponse.json({ error: "THREAD_NOT_FOUND" }, { status: 404 });

  const messages =
    parsed.data.mode === "rewrite"
      ? [
          { role: "system" as const, content: reply.memory ? `${REWRITE_PROMPT}\n\n${reply.memory}` : REWRITE_PROMPT },
          {
            role: "user" as const,
            content: `${replyContextText(reply)}\n\nWhat the host wants to say:\n${parsed.data.text}`,
          },
        ]
      : [
          { role: "system" as const, content: TRANSLATE_PROMPT },
          {
            role: "user" as const,
            content: `The guest's latest message (for the language only):\n${reply.lastGuestText}\n\nThe host's message to translate:\n${parsed.data.text}`,
          },
        ];

  const result = await kimiChat({ messages, maxTokens: 2000, thinking: false });
  if (!result.ok) return NextResponse.json({ error: "COMPOSE_FAILED", reason: result.reason }, { status: 502 });

  return NextResponse.json({
    text: result.content,
    libraryUsed: parsed.data.mode === "rewrite" ? reply.libraryUsed : [],
  });
}
