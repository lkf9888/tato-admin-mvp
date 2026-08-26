import { authenticateAgent } from "@/lib/agent-auth";
import { corsPreflight, withCors } from "@/lib/agent-cors";
import { iso, MAX_PAGE_SIZE, parseLimit } from "@/lib/agent-read";
import { groupIntoThreads } from "@/lib/guest-threads";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

/**
 * Guest conversations.
 *
 * Grouped by guest and car rather than returned as loose emails,
 * because that is what a conversation is and an agent deciding "has
 * this been answered" needs the whole thread, not one notification
 * from it.
 *
 * Not cursor-paginated, and the reason is structural: threads are
 * assembled in memory from the mail and then re-sorted so anything
 * unanswered floats above anything handled. There is no stable row to
 * put a cursor on. The window is bounded instead by how much mail is
 * read -- a quarter's worth, which is more conversation than any
 * automation needs and cannot grow without bound as the mailbox does.
 *
 * What this does not carry is our own replies. Turo notifies on the
 * guest's messages and says nothing when the host answers, so unless
 * the browser reader has been over a thread, every conversation here
 * is one-sided by construction rather than by omission.
 */
export async function GET(request: Request) {
  const agent = await authenticateAgent(request, "read");
  if (!agent) return withCors({ error: "UNAUTHORIZED" }, { status: 401 });

  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get("limit"));
  const unansweredOnly = url.searchParams.get("unansweredOnly") === "true";
  const vehicleId = url.searchParams.get("vehicleId");
  const query = url.searchParams.get("q")?.trim().toLowerCase();

  const emails = await prisma.inboundEmail.findMany({
    where: {
      workspaceId: agent.workspaceId,
      kind: { in: ["GUEST_MESSAGE", "SUPPORT"] },
      ...(vehicleId ? { OR: [{ vehicleId }, { order: { vehicleId } }] } : {}),
    },
    orderBy: { receivedAt: "desc" },
    // Same window the messages page reads. Bounds the response against
    // a mailbox that only grows.
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
      guestText: true,
      guestTextZh: true,
      summaryZh: true,
      avatarUrl: true,
      parsed: true,
      vehicle: { select: { brand: true, model: true, year: true, plateNumber: true } },
      order: {
        select: {
          vehicleId: true,
          vehicle: { select: { brand: true, model: true, year: true, plateNumber: true } },
        },
      },
    },
  });

  const threads = groupIntoThreads(
    emails.map((email) => {
      const extracted = (() => {
        if (!email.parsed) return null;
        try {
          return JSON.parse(email.parsed) as { summary?: string; needsAction?: boolean };
        } catch {
          return null;
        }
      })();

      // The subject names a model; the matched trip names a car.
      // Prefer the trip -- it is an exact join, where the subject is a
      // model several cars in the fleet may share.
      const vehicle = email.vehicle ?? email.order?.vehicle ?? null;

      return {
        id: email.id,
        subject: email.subject,
        guestName: email.guestName,
        vehicleId: email.vehicleId ?? email.order?.vehicleId ?? null,
        vehicleLabel: vehicle ? `${vehicle.year} ${vehicle.brand} ${vehicle.model}` : null,
        vehiclePlate: vehicle?.plateNumber ?? null,
        avatarUrl: email.avatarUrl,
        receivedAt: email.receivedAt,
        acknowledgedAt: email.acknowledgedAt,
        turoLink: email.turoLink,
        orderId: email.orderId,
        guestText: email.guestText,
        summary: extracted?.summary ?? null,
        summaryZh: email.guestText ? email.guestTextZh : email.summaryZh,
        summaryZhBrief: email.summaryZh ?? null,
        needsAction: extracted?.needsAction === true,
      };
    }),
  );

  const filtered = threads
    .filter((thread) => (unansweredOnly ? thread.openCount > 0 : true))
    .filter((thread) => {
      if (!query) return true;
      return [
        thread.guestName,
        thread.vehicleLabel,
        thread.vehiclePlate,
        thread.latestSummary,
        ...thread.messages.flatMap((message) => [message.subject, message.guestText]),
      ]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(query));
    });

  return withCors({
    data: filtered.slice(0, limit).map((thread) => ({
      key: thread.key,
      guestName: thread.guestName,
      vehicle: thread.vehicleId
        ? { id: thread.vehicleId, plateNumber: thread.vehiclePlate, label: thread.vehicleLabel }
        : null,
      /** The trip these messages are about, when one matched. Null
       *  means the subject named a model the fleet could not resolve
       *  to a single car -- see /api/agent/pending-orders. */
      orderId: thread.orderId,
      latestAt: iso(thread.latestAt),
      /** Messages nobody has marked handled. Zero means the thread is
       *  dealt with, as far as TATO can tell. */
      openCount: thread.openCount,
      /** Where to reply. TATO cannot send on this channel. */
      turoLink: thread.turoLink,
      messages: thread.messages.map((message) => ({
        id: message.id,
        receivedAt: iso(message.receivedAt),
        subject: message.subject,
        /** What the guest wrote, when Turo's template carried it.
         *  Null means only a summary is available. */
        guestText: message.guestText,
        summary: message.summary,
        summaryZh: message.summaryZh,
        acknowledgedAt: iso(message.acknowledgedAt),
        needsAction: message.needsAction,
      })),
    })),
    /** Threads are assembled and re-sorted in memory, so there is no
     *  stable cursor to hand back. Raise `limit` (max
     *  MAX_PAGE_SIZE) or narrow with filters instead. */
    nextCursor: null,
    truncated: filtered.length > limit,
    maxLimit: MAX_PAGE_SIZE,
  });
}

export function OPTIONS() {
  return corsPreflight();
}
