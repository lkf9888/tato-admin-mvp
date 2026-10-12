import "server-only";

import { cleanGuestMessage as clean, mergeGuestConversation } from "@/lib/guest-conversation";
import { assistantMemoryPrompt } from "@/lib/assistant-memory";
import { getVehicleReplyKnowledge } from "@/lib/guest-reply-context";
import { knowledgeForConversation } from "@/lib/message-knowledge-server";
import { prisma } from "@/lib/prisma";

/**
 * Everything a reply to a guest is written from, for the three ways one
 * gets written: drafted from the thread, rewritten from the host's
 * shorthand, translated. One place, so the three cannot disagree about
 * what the AI knows.
 */

export const REPLY_RULES = [
  "Write in the language the guest writes in (look at their latest message). If you cannot tell, write English.",
  "Plain, warm, everyday wording -- like a quick text between two people, not a formal letter. No greeting, no sign-off, no restating their question.",
  "Never invent details: pickup addresses, codes, prices, times, policies. If something is not in the trip facts or the host's library, say you will check and get back to them.",
  "The latest relevant host reply in this same conversation may confirm facts for this trip only. Never generalize it to another trip, and never reuse a historical access code. Keep {{pickup_code}} for the host to fill.",
  "Read the latest guest message together with the preceding guest messages. Resolve words such as it, there and again from that exchange, not from an unrelated template or older topic. If the referent is unclear, ask what they mean.",
  "A confirmed option is not an exclusive policy: if the host said a guest can pay a parking ticket online, say that option without claiming tickets never go through Turo. Do not add always, never, must, or cannot unless the evidence explicitly supports it.",
  "Pickup and return are separate. Use only the confirmed address and instructions for the direction asked about; never borrow the other direction when an address is missing. A requested change is not confirmed until the trip is updated.",
  "Output only the message text -- no preamble, no quotes, no explanation.",
].join("\n");

export async function loadReplyContext(input: {
  workspaceId: string;
  emailIds: string[];
  guestName: string;
  vehicleId: string | null;
  /** The message being answered, when one was picked. */
  emailId?: string | null;
}) {
  const emails = await prisma.inboundEmail.findMany({
    where: { workspaceId: input.workspaceId, id: { in: input.emailIds } },
    orderBy: { receivedAt: "desc" },
    // The API accepts at most 60 ids. Do not discard a specifically selected
    // older message before resolving it. Bound the prompt after selection.
    take: 60,
    select: {
      id: true,
      bodyText: true,
      guestText: true,
      receivedAt: true,
      parsed: true,
      order: { include: { vehicle: { select: { plateNumber: true, brand: true, model: true, year: true } } } },
    },
  });
  if (emails.length === 0) return null;

  const target = input.emailId ? emails.find((email) => email.id === input.emailId) : null;
  if (input.emailId && !target) return null;
  const latest = target ?? emails[0];
  const order = latest.order ?? emails.find((email) => email.order)?.order ?? null;
  const vehicleId = order?.vehicleId ?? input.vehicleId ?? null;
  const vehicle =
    order?.vehicle ??
    (vehicleId
      ? await prisma.vehicle.findFirst({
          where: { id: vehicleId, workspaceId: input.workspaceId },
          select: { plateNumber: true, brand: true, model: true, year: true },
        })
      : null);
  // Reader imports may contain only the host's side. They complement the
  // notification emails; they must never replace the guest's questions.
  const historicalTarget = latest.id !== emails[0].id;
  const recorded = order?.externalOrderId
    ? await prisma.turoConversationMessage.findMany({
        where: { workspaceId: input.workspaceId, reservationId: order.externalOrderId, ...(historicalTarget ? { sentAt: { lte: latest.receivedAt } } : {}) },
        orderBy: { sentAt: "desc" },
        take: 20,
        select: { direction: true, body: true, sentAt: true },
      })
    : [];

  const guestEmails = emails
    .filter((email) => email.receivedAt <= latest.receivedAt && (!order || !email.order || email.order.id === order.id))
    .slice(0, 12);
  const messages = mergeGuestConversation(
    recorded.map(message => ({ body: message.body, outbound: message.direction === "outbound", at: message.sentAt.toISOString() })),
    guestEmails.map(email => ({ body: email.guestText ?? email.bodyText, outbound: false, at: email.receivedAt.toISOString() })),
  );
  const transcript = messages
    .map(message => `[${message.at.slice(0, 16).replace("T", " ")} UTC] ${message.outbound ? "Host" : "Guest"}: ${message.body.slice(0, 1200)}`)
    .join("\n");
  const lastGuestText = clean(latest.guestText ?? latest.bodyText).slice(0, 1200);
  const questionContext = [...guestEmails.slice(0, 3)].reverse()
    .map((email) => clean(email.guestText ?? email.bodyText).slice(0, 600)).join("\n");

  const [memory, carNotes, library] = await Promise.all([
    assistantMemoryPrompt(input.workspaceId),
    getVehicleReplyKnowledge(input.workspaceId, vehicleId),
    knowledgeForConversation({
      workspaceId: input.workspaceId,
      vehicleId,
      trip: order,
      guestName: input.guestName,
      question: questionContext,
    }),
  ]);

  const facts = [
    `Guest: ${input.guestName}`,
    vehicle ? `Vehicle: ${vehicle.year} ${vehicle.brand} ${vehicle.model} (${vehicle.plateNumber})` : "Vehicle: not identified -- do not name one.",
    order
      ? `Trip (Vancouver time): ${order.pickupDatetime.toLocaleString("en-CA", { timeZone: "America/Vancouver" })} → ${order.returnDatetime.toLocaleString("en-CA", { timeZone: "America/Vancouver" })}`
      : "No matching trip on file -- do not state any dates.",
    `Confirmed pickup: ${order?.pickupLocation || "unknown -- do not substitute the return address"}`,
    `Confirmed return: ${order?.returnLocation || "unknown -- do not substitute the pickup address"}`,
    carNotes ? `Car notes from the host:\n${carNotes}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    memory,
    facts,
    library: library.text,
    libraryUsed: library.used,
    transcript,
    lastGuestText,
    /** Shown on its own when one message was picked to answer. */
    focus: lastGuestText,
  };
}

/** The user part of a prompt: facts, library, examples, conversation. */
export function replyContextText(context: NonNullable<Awaited<ReturnType<typeof loadReplyContext>>>) {
  return [
    `Trip facts:\n${context.facts}`,
    context.library ?? "",
    `Conversation:\n${context.transcript}`,
    context.focus ? `Reply to this message specifically:\n${context.focus}` : "",
  ]
    .filter(Boolean)
    .join("\n\n")
    // Current-trip imports can carry access codes too. Only the browser may
    // fill a code from the matched order; never teach it to the model.
    .replace(/((?:\bpin|\b(?:lockbox|key|access|door|pickup|pick-up|security)\s*code|密码)\s*(?:(?:is|为|是)\s*)?[:：]?\s*)(?=[a-z0-9]*\d)[a-z0-9]{3,12}\b/gi, "$1{{pickup_code}}");
}
