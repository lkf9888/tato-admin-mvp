import { NextResponse } from "next/server";
import { z } from "zod";

import { requireCurrentAdminContext } from "@/lib/auth";
import { loadReplyContext, replyContextText, REPLY_RULES } from "@/lib/guest-reply-prompt";
import { isKimiConfigured, kimiChat } from "@/lib/kimi";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

// Same shape of bound as the assistant: far above what a person types,
// far below what a stuck client loop sends.
const DRAFT_LIMIT = 40;
const DRAFT_WINDOW_MS = 10 * 60 * 1000;

const draftSchema = z.object({
  /** The thread's message ids. See the note in the translate route:
   *  guest + vehicle stopped identifying a thread once the page began
   *  resolving the car from the matched trip. */
  emailIds: z.array(z.string().trim().min(1)).min(1).max(60),
  guestName: z.string().trim().min(1).max(200),
  // `.nullish()` rather than `.optional()`: the client holds this in
  // state initialised to null and JSON.stringify sends the key. The
  // assistant shipped broken for exactly this reason.
  vehicleId: z.string().trim().min(1).nullish(),
  /** Optional steer from the operator, e.g. "tell them 4pm works". */
  instruction: z.string().trim().max(500).nullish(),
  /** Draft a reply to this message specifically. The thread is still
   *  read for context -- a guest's question rarely stands alone -- but
   *  the reply answers this one, which is what the operator pressed
   *  the button next to. */
  emailId: z.string().trim().min(1).nullish(),
});

const SYSTEM_PROMPT = [
  "You draft replies for a Turo host answering a guest by message.",
  "Write ONE short reply: 1-3 short sentences, answering only what the guest actually asked.",
  REPLY_RULES,
].join("\n");

/**
 * Draft a reply to a guest thread.
 *
 * Drafting only. Turo has no send API and TATO holds no guest contact
 * details, so there is nothing here that could send even if it wanted
 * to -- the operator copies the text into Turo themselves. The model
 * writes, a person sends.
 */
export async function POST(request: Request) {
  let context;
  try {
    context = await requireCurrentAdminContext();
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  if (!isKimiConfigured()) {
    return NextResponse.json({ error: "ASSISTANT_NOT_CONFIGURED" }, { status: 503 });
  }

  const parsed = draftSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });
  }

  const ip = await getClientIp();
  const decision = await checkRateLimit({
    scope: "message_draft",
    identifier: `${context.workspace.id}:${ip}`,
    maxAttempts: DRAFT_LIMIT,
    windowMs: DRAFT_WINDOW_MS,
  });
  if (!decision.allowed) {
    return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
  }

  const reply = await loadReplyContext({
    workspaceId: context.workspace.id,
    emailIds: parsed.data.emailIds,
    guestName: parsed.data.guestName,
    vehicleId: parsed.data.vehicleId ?? null,
    emailId: parsed.data.emailId ?? null,
  });
  if (!reply) {
    return NextResponse.json({ error: "THREAD_NOT_FOUND" }, { status: 404 });
  }

  const steer = parsed.data.instruction ? `\n\nThe host wants you to convey: ${parsed.data.instruction}` : "";
  const result = await kimiChat({
    messages: [
      { role: "system", content: reply.memory ? `${SYSTEM_PROMPT}\n\n${reply.memory}` : SYSTEM_PROMPT },
      { role: "user", content: `${replyContextText(reply)}${steer}` },
    ],
    maxTokens: 3000,
    // A reply read off facts already in the prompt: nothing to deliberate.
    thinking: false,
  });

  if (!result.ok) {
    return NextResponse.json({ error: "DRAFT_FAILED", reason: result.reason }, { status: 502 });
  }

  return NextResponse.json({ draft: result.content, libraryUsed: reply.libraryUsed });
}
