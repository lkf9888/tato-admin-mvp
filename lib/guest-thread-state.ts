import "server-only";

import { groupIntoThreads } from "@/lib/guest-threads";
import { prisma } from "@/lib/prisma";

/**
 * Guest conversations and which of them still need a reply.
 *
 * One function for the messages page and for the nav badge, so the
 * number on the badge and the "needs reply" count on the page cannot
 * disagree: both come from here.
 */
export async function loadGuestThreads(workspaceId: string) {
  const emails = await prisma.inboundEmail.findMany({
    where: {
      workspaceId,
      kind: { in: ["GUEST_MESSAGE", "SUPPORT"] },
    },
    orderBy: { receivedAt: "desc" },
    // A quarter's worth of conversation is plenty to work from, and
    // bounds the page against a mailbox that only grows.
    take: 400,
    select: {
      id: true,
      subject: true,
      guestName: true,
      vehicleId: true,
      receivedAt: true,
      acknowledgedAt: true,
      turoLink: true,
      orderId: true,
      parsed: true,
      guestText: true,
      guestTextZh: true,
      summaryZh: true,
      avatarUrl: true,
      vehicle: { select: { brand: true, model: true, year: true, plateNumber: true } },
      // The order knows exactly which car; the subject only knows the
      // model. Three Honda Odysseys in this fleet means "Honda Odyssey"
      // identifies none of them, and the message showed "car not
      // identified" while its own matched trip named the plate.
      order: {
        select: {
          vehicleId: true,
          vehicle: { select: { brand: true, model: true, year: true, plateNumber: true } },
        },
      },
    },
  });

  // What we said. Turo sends no notification when the host replies, so
  // these exist only where the reader or an agent has recorded the
  // conversation. Keyed by reservation, which is how Turo threads a
  // conversation and how the order already joins.
  const reservationIds = [
    ...new Set(
      emails
        .map((email) => {
          if (!email.parsed) return null;
          try {
            return (JSON.parse(email.parsed) as { reservationId?: string }).reservationId ?? null;
          } catch {
            return null;
          }
        })
        .filter((id): id is string => !!id),
    ),
  ];

  const scraped = reservationIds.length
    ? await prisma.turoConversationMessage.findMany({
        where: { workspaceId, reservationId: { in: reservationIds } },
        orderBy: { sentAt: "desc" },
        take: 400,
      })
    : [];

  // When our last word came after theirs, the thread is answered --
  // whatever anyone did or did not tick in TATO. Only meaningful for
  // reservations that have been recorded; the rest keep the
  // acknowledgement rule, which is all the mailbox alone can support.
  const lastReplyAt = new Map<string, Date>();
  for (const message of scraped) {
    if (message.direction !== "outbound") continue;
    const current = lastReplyAt.get(message.reservationId);
    if (!current || message.sentAt > current) lastReplyAt.set(message.reservationId, message.sentAt);
  }

  const threads = groupIntoThreads(
    emails.map((email) => {
      const extracted = (() => {
        if (!email.parsed) return null;
        try {
          return JSON.parse(email.parsed) as { summary?: string; summaryZh?: string; needsAction?: boolean };
        } catch {
          return null;
        }
      })();

      // The subject names a model; the trip names a car. Prefer the
      // trip -- it is an exact join on the reservation id, where the
      // subject match is a model that several cars share.
      const vehicle = email.vehicle ?? email.order?.vehicle ?? null;
      const vehicleId = email.vehicleId ?? email.order?.vehicleId ?? null;

      return {
        id: email.id,
        subject: email.subject,
        guestName: email.guestName,
        vehicleId,
        vehicleLabel: vehicle ? `${vehicle.year} ${vehicle.brand} ${vehicle.model}` : null,
        vehiclePlate: vehicle?.plateNumber ?? null,
        avatarUrl: email.avatarUrl,
        receivedAt: email.receivedAt,
        acknowledgedAt: email.acknowledgedAt,
        turoLink: email.turoLink,
        orderId: email.orderId,
        guestText: email.guestText,
        summary: extracted?.summary ?? null,
        // Both readings travel to the client, which picks one. A
        // literal translation is what you need to answer someone; a
        // summary is what you need to decide whether to.
        //
        // The literal falls back to nothing rather than to the
        // summary: a summary shown where a translation was asked for
        // is a paraphrase wearing the wrong label.
        summaryZh: email.guestText ? email.guestTextZh : email.summaryZh,
        summaryZhBrief: email.summaryZh ?? extracted?.summaryZh ?? null,
        needsAction: extracted?.needsAction === true,
      };
    }),
  );

  const orderIds = threads.map((thread) => thread.orderId).filter((id): id is string => !!id);
  const orderReservations = orderIds.length
    ? await prisma.order.findMany({
        where: { id: { in: orderIds }, workspaceId },
        select: { id: true, externalOrderId: true },
      })
    : [];
  const reservationByOrderId = new Map(
    orderReservations
      .filter((order) => order.externalOrderId)
      .map((order) => [order.id, order.externalOrderId as string]),
  );

  // Threads whose last inbound message predates our last reply are
  // answered. Computed here rather than inside `groupIntoThreads`,
  // which is pure and has no business knowing about recorded replies.
  const answeredKeys = new Set(
    threads
      .filter((thread) => {
        const reservationId = thread.orderId ? reservationByOrderId.get(thread.orderId) : undefined;
        if (!reservationId) return false;
        const repliedAt = lastReplyAt.get(reservationId);
        if (!repliedAt) return false;
        return thread.messages.every((message) => message.receivedAt < repliedAt);
      })
      .map((thread) => thread.key),
  );

  return { threads, scraped, reservationIds, answeredKeys };
}

/** Conversations with a guest message nobody has answered or handled. */
export async function countThreadsNeedingReply(workspaceId: string) {
  const { threads, answeredKeys } = await loadGuestThreads(workspaceId);
  return threads.filter((thread) => thread.openCount > 0 && !answeredKeys.has(thread.key)).length;
}
