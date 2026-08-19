import { NextResponse } from "next/server";
import { z } from "zod";

import { requireCurrentAdminContext } from "@/lib/auth";
import { isKimiConfigured, kimiChat } from "@/lib/kimi";
import { prisma } from "@/lib/prisma";
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
  "Write ONE short reply in plain, warm, everyday English — like a quick text between two people, not a formal letter.",
  "Keep it to 1–3 short sentences. Answer only what the guest actually asked. No greeting, no sign-off, no restating their question.",
  "Never invent details you were not given: pickup addresses, lockbox codes, prices, or times. If the guest asks for something not in the context, say you will confirm shortly.",
  "The trip facts you are given are the only facts you have. Do not add to them.",
  "Output only the reply text — no preamble, no quotes, no explanation.",
  // These models reason before answering and the reasoning dominates
  // the wait: measured at 14.4s for a 70-character reply. The reply is
  // one or two sentences read off facts that are already in the
  // prompt, so there is nothing here worth deliberating about.
  "Answer directly from the facts given. Do not deliberate, plan, or weigh options.",
].join("\n");

/**
 * Draft a reply to a guest thread.
 *
 * Drafting only. Turo has no send API and TATO holds no guest contact
 * details, so there is nothing here that could send even if it wanted
 * to — the operator copies the text into Turo themselves. That is the
 * same boundary the assistant works under, and it is deliberate:
 * the model writes, a person sends.
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

  const emails = await prisma.inboundEmail.findMany({
    where: {
      workspaceId: context.workspace.id,
      id: { in: parsed.data.emailIds },
    },
    orderBy: { receivedAt: "desc" },
    // Five, not eight. A guest's question is answered by the last
    // exchange, not by the whole history, and every extra message is
    // prompt the model reads before it starts.
    take: 5,
    select: { id: true, subject: true, bodyText: true, receivedAt: true, parsed: true, order: true },
  });

  if (emails.length === 0) {
    return NextResponse.json({ error: "THREAD_NOT_FOUND" }, { status: 404 });
  }

  const order = emails.find((email) => email.order)?.order ?? null;
  const vehicle = parsed.data.vehicleId
    ? await prisma.vehicle.findFirst({
        where: { id: parsed.data.vehicleId, workspaceId: context.workspace.id },
        select: { brand: true, model: true, year: true },
      })
    : null;

  // Oldest first so the model reads the conversation in the order it
  // happened. Bodies are trimmed hard: Turo wraps each message in a
  // long notification template, and the guest's actual words are near
  // the top.
  const target = parsed.data.emailId
    ? emails.find((email) => email.id === parsed.data.emailId)
    : null;

  const transcript = [...emails]
    .reverse()
    .map((email) => {
      const summary = (() => {
        if (!email.parsed) return null;
        try {
          return (JSON.parse(email.parsed) as { summary?: string }).summary ?? null;
        } catch {
          return null;
        }
      })();
      return [
        `[${email.receivedAt.toISOString().slice(0, 16).replace("T", " ")}]`,
        summary ? `Summary: ${summary}` : "",
        email.bodyText.slice(0, 400),
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n---\n");

  const facts = [
    `Guest: ${parsed.data.guestName}`,
    vehicle ? `Vehicle: ${vehicle.year} ${vehicle.brand} ${vehicle.model}` : "",
    order
      ? `Trip: ${order.pickupDatetime.toISOString().slice(0, 16).replace("T", " ")} → ${order.returnDatetime.toISOString().slice(0, 16).replace("T", " ")}`
      : "No matching trip on file — do not state any dates.",
    order?.pickupLocation ? `Pickup: ${order.pickupLocation}` : "",
    parsed.data.instruction ? `The host wants you to convey: ${parsed.data.instruction}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const focus = target
    ? `\n\nReply to this message specifically:\n${target.bodyText.slice(0, 600)}`
    : "";

  const result = await kimiChat({
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Trip facts:\n${facts}\n\nConversation:\n${transcript}${focus}`,
      },
    ],
    // Capped rather than generous. The budget bounds reasoning as well
    // as output, and a two-sentence reply that needs more than this is
    // a reply that has gone wrong. If it truncates, the error says so
    // plainly rather than returning empty.
    maxTokens: 1200,
  });

  if (!result.ok) {
    return NextResponse.json({ error: "DRAFT_FAILED", reason: result.reason }, { status: 502 });
  }

  return NextResponse.json({ draft: result.content });
}
