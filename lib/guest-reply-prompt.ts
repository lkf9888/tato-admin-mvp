import "server-only";

import { assistantMemoryPrompt } from "@/lib/assistant-memory";
import { findSimilarPastReplies, getVehicleReplyKnowledge } from "@/lib/guest-reply-context";
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
  "You may be shown how this host answered similar questions before. Match their tone and what they usually say, but never copy a code, address, time or price from those answers -- only the trip facts, car notes and library are current.",
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
    // Five: a guest's question is answered by the last exchange, and
    // every extra message is prompt read before the answer starts.
    take: 5,
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

  const order = emails.find((email) => email.order)?.order ?? null;
  const vehicleId = input.vehicleId ?? order?.vehicleId ?? null;
  const vehicle =
    order?.vehicle ??
    (vehicleId
      ? await prisma.vehicle.findFirst({
          where: { id: vehicleId, workspaceId: input.workspaceId },
          select: { plateNumber: true, brand: true, model: true, year: true },
        })
      : null);
  const target = input.emailId ? emails.find((email) => email.id === input.emailId) : null;

  // The recorded conversation, when there is one, is the better
  // transcript: it has both sides, so a reply does not repeat an answer
  // already given an hour ago.
  const recorded = order?.externalOrderId
    ? await prisma.turoConversationMessage.findMany({
        where: { workspaceId: input.workspaceId, reservationId: order.externalOrderId },
        orderBy: { sentAt: "desc" },
        take: 8,
        select: { direction: true, body: true, sentAt: true },
      })
    : [];

  const stamp = (date: Date) => date.toISOString().slice(0, 16).replace("T", " ");
  const transcript =
    recorded.length > 0
      ? [...recorded]
          .reverse()
          .map((message) => `[${stamp(message.sentAt)}] ${message.direction === "outbound" ? "Host" : "Guest"}: ${message.body.slice(0, 400)}`)
          .join("\n")
      : [...emails]
          .reverse()
          .map((email) => `[${stamp(email.receivedAt)}] Guest: ${(email.guestText ?? email.bodyText).slice(0, 400)}`)
          .join("\n");

  const latest = target ?? emails[0];
  const lastGuestText = (latest.guestText ?? latest.bodyText).slice(0, 600);

  const [memory, carNotes, pastReplies, library] = await Promise.all([
    assistantMemoryPrompt(input.workspaceId),
    getVehicleReplyKnowledge(input.workspaceId, vehicleId),
    findSimilarPastReplies({
      workspaceId: input.workspaceId,
      question: lastGuestText,
      vehicleId,
      excludeReservationId: order?.externalOrderId ?? null,
    }),
    knowledgeForConversation({
      workspaceId: input.workspaceId,
      vehicleId,
      trip: order,
      guestName: input.guestName,
      question: lastGuestText,
    }),
  ]);

  const facts = [
    `Guest: ${input.guestName}`,
    vehicle ? `Vehicle: ${vehicle.year} ${vehicle.brand} ${vehicle.model} (${vehicle.plateNumber})` : "Vehicle: not identified -- do not name one.",
    order
      ? `Trip (Vancouver time): ${order.pickupDatetime.toLocaleString("en-CA", { timeZone: "America/Vancouver" })} → ${order.returnDatetime.toLocaleString("en-CA", { timeZone: "America/Vancouver" })}`
      : "No matching trip on file -- do not state any dates.",
    order?.pickupLocation ? `Pickup: ${order.pickupLocation}` : "",
    order?.returnLocation && order.returnLocation !== order.pickupLocation ? `Return: ${order.returnLocation}` : "",
    carNotes ? `Car notes from the host:\n${carNotes}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const examples = pastReplies.length
    ? `How this host answered similar questions before (tone only; facts may be out of date):\n${pastReplies
        .map((pair) => `Guest: ${pair.asked}\nHost: ${pair.answered}`)
        .join("\n---\n")}`
    : "";

  return {
    memory,
    facts,
    library: library.text,
    libraryUsed: library.used,
    examples,
    transcript,
    lastGuestText,
    /** Shown on its own when one message was picked to answer. */
    focus: target ? (target.guestText ?? target.bodyText).slice(0, 600) : null,
  };
}

/** The user part of a prompt: facts, library, examples, conversation. */
export function replyContextText(context: NonNullable<Awaited<ReturnType<typeof loadReplyContext>>>) {
  return [
    `Trip facts:\n${context.facts}`,
    context.library ?? "",
    context.examples,
    `Conversation:\n${context.transcript}`,
    context.focus ? `Reply to this message specifically:\n${context.focus}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
