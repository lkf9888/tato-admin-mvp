import { GuestMessagesView } from "@/components/guest-messages-view";
import { requireCurrentAdminContext } from "@/lib/auth";
import { groupIntoThreads } from "@/lib/guest-threads";
import { getI18n } from "@/lib/i18n-server";
import { isKimiConfigured } from "@/lib/kimi";
import { prisma } from "@/lib/prisma";
import { classifyTuroSubject } from "@/lib/turo-subjects";
import { matchVehiclesForEmail } from "@/lib/turo-message-match";
import { isPlateUnconfirmed } from "@/lib/vehicle-assignment";
import { getNetEarningFromFinancials } from "@/lib/utils";

/**
 * Why a message could not be filed against a trip.
 *
 * A guest notification carries no reservation id, so the trip is found
 * by name plus the car named in the subject. When that fails the page
 * used to say only "no trip matched", which is true and useless: the
 * operator cannot tell a car missing from the fleet from two cars of
 * the same model, and those want opposite actions -- add the vehicle,
 * or set a plate override.
 *
 * `noVehicleText` is the third case and a different problem again: the
 * subject named no car at all, so there was nothing to match on.
 */
type UnmatchedReason =
  | { kind: "noVehicleText" }
  | { kind: "noSuchVehicle"; vehicleText: string; nearest: string[] }
  | { kind: "severalVehicles"; vehicleText: string; count: number }
  | { kind: "noTripInWindow"; vehicleText: string };

/**
 * Guest messages.
 *
 * The whole page exists because of one gap: Turo emails a notification
 * for every guest message but gives no API to read or answer them. So
 * this reads the notifications we already ingest, groups them back into
 * conversations, puts the matching trip beside each one, and hands off
 * to Turo for the reply itself.
 */
export default async function GuestMessagesPage() {
  const [{ locale, messages }, { workspace }] = await Promise.all([
    getI18n(),
    requireCurrentAdminContext(),
  ]);

  // Needed to explain a thread with no trip. The system already knows
  // why it could not file one -- the subject named a car, and either
  // no vehicle in the fleet answers to it or several do -- and until
  // now that reason was computed during sync and thrown away into a
  // log line, leaving the page saying only "no trip matched".
  const fleet = await prisma.vehicle.findMany({
    where: { workspaceId: workspace.id },
    select: {
      id: true,
      brand: true,
      model: true,
      year: true,
      nickname: true,
      turoListingName: true,
      turoAccount: true,
      plateNumber: true,
    },
  });

  function explainUnmatched(subject: string): UnmatchedReason | null {
    const parsed = classifyTuroSubject(subject);
    const vehicleText = parsed?.vehicleText?.trim();
    if (!vehicleText) return { kind: "noVehicleText" };

    const { matches } = matchVehiclesForEmail(vehicleText, fleet, parsed?.coHostAccount ?? null);
    if (matches.length === 0) {
      // "No car answers to that" is true and still leaves the operator
      // guessing, because the usual cause is a car that IS in the
      // fleet under a name that does not line up -- a trim word, a
      // different model spelling. Naming the closest rows turns it
      // into a thing they can look at and fix.
      const wanted = vehicleText.toLowerCase().split(/[^a-z0-9]+/i).filter(Boolean);
      const nearest = fleet
        .map((vehicle) => {
          const label = `${vehicle.year} ${vehicle.brand} ${vehicle.model}`;
          const tokens = new Set(
            `${vehicle.brand} ${vehicle.model} ${vehicle.nickname} ${vehicle.turoListingName ?? ""}`
              .toLowerCase()
              .split(/[^a-z0-9]+/)
              .filter(Boolean),
          );
          const shared = wanted.filter((token) => tokens.has(token)).length;
          return { label, plate: vehicle.plateNumber, shared };
        })
        // One shared word is a coincidence -- every Ford shares "ford".
        .filter((row) => row.shared >= 2)
        .sort((a, b) => b.shared - a.shared)
        .slice(0, 3)
        .map((row) => (row.plate ? `${row.plate} · ${row.label}` : row.label));

      return { kind: "noSuchVehicle", vehicleText, nearest };
    }
    if (matches.length > 1) {
      return { kind: "severalVehicles", vehicleText, count: matches.length };
    }
    // The car is known and unique, so the miss is on the trip side --
    // no booking for this guest on this car within the window.
    return { kind: "noTripInWindow", vehicleText };
  }

  const emails = await prisma.inboundEmail.findMany({
    where: {
      workspaceId: workspace.id,
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
  // these exist only where the browser agent has read the conversation
  // back off the site. Keyed by reservation, which is how Turo threads
  // a conversation and how the order already joins.
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
        where: { workspaceId: workspace.id, reservationId: { in: reservationIds } },
        orderBy: { sentAt: "desc" },
        take: 400,
      })
    : [];

  // When our last word came after theirs, the thread is answered --
  // whatever anyone did or did not tick in TATO. Only meaningful for
  // reservations the reader has reached; the rest keep the
  // acknowledgement rule, which is all the mailbox alone can support.
  const lastReplyAt = new Map<string, Date>();
  for (const message of scraped) {
    if (message.direction !== "outbound") continue;
    const current = lastReplyAt.get(message.reservationId);
    if (!current || message.sentAt > current) lastReplyAt.set(message.reservationId, message.sentAt);
  }

  const reservationByOrderId = new Map<string, string>();

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
        // summary is what you need to decide whether to. Neither is
        // the right default for both jobs, so the operator chooses.
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

  // Trips for the threads that matched one, fetched in a single query
  // rather than per thread.
  const orderIds = threads.map((thread) => thread.orderId).filter((id): id is string => !!id);
  const orders = orderIds.length
    ? await prisma.order.findMany({
        where: { id: { in: orderIds }, workspaceId: workspace.id },
        select: {
          id: true,
          renterName: true,
          pickupDatetime: true,
          returnDatetime: true,
          pickupLocation: true,
          returnLocation: true,
          renterPhone: true,
          externalOrderId: true,
          status: true,
          totalPrice: true,
          sourceMetadata: true,
          source: true,
          importBatchId: true,
          vehicle: { select: { brand: true, model: true, year: true, plateNumber: true } },
        },
      })
    : [];

  for (const order of orders) {
    if (order.externalOrderId) reservationByOrderId.set(order.id, order.externalOrderId);
  }

  // Threads whose last inbound message predates our last reply are
  // answered. Recomputed here rather than inside `groupIntoThreads`,
  // which is pure and has no business knowing about scraped data.
  const answeredThreads = new Set(
    threads
      .filter((thread) => {
        const reservationId = thread.orderId
          ? reservationByOrderId.get(thread.orderId)
          : undefined;
        if (!reservationId) return false;
        const repliedAt = lastReplyAt.get(reservationId);
        if (!repliedAt) return false;
        return thread.messages.every((message) => message.receivedAt < repliedAt);
      })
      .map((thread) => thread.key),
  );

  const t = messages.guestMessagesPage;

  return (
    <div className="space-y-3">
      <header className="rounded-lg border border-[var(--line)] bg-[var(--panel-strong)] px-3 py-3 sm:px-4">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--ink-soft)]">
          {t.kicker}
        </p>
        <h1 className="mt-0.5 text-[17px] font-semibold text-[var(--ink)] sm:text-[19px]">
          {t.title}
        </h1>
        <p className="mt-1 max-w-3xl text-[12px] leading-5 text-[var(--ink-soft)]">{t.copy}</p>
      </header>

      <GuestMessagesView
        locale={locale}
        canDraft={isKimiConfigured()}
        // Keyed by reservation, which is how Turo threads a
        // conversation. A thread reaches it through its matched trip's
        // externalOrderId; threads with no matched trip simply have no
        // entry and keep showing the email-derived view.
        conversations={Object.fromEntries(
          reservationIds.map((reservationId) => [
            reservationId,
            scraped
              .filter((message) => message.reservationId === reservationId)
              .sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime())
              .map((message) => ({
                id: message.id,
                direction: message.direction,
                authorName: message.authorName,
                body: message.body,
                bodyZh: message.bodyZh,
                sentAt: message.sentAt.toISOString(),
              })),
          ]).filter(([, list]) => (list as unknown[]).length > 0),
        )}
        threads={threads.map((thread) => ({
          ...thread,
          // Why there is no trip, when there is no trip. Recomputed
          // rather than stored: it is pure string work over the
          // subject we already have, and a vehicle added to the fleet
          // tomorrow should change the answer without a migration.
          unmatchedReason: thread.orderId ? null : explainUnmatched(thread.messages[0]?.subject ?? ""),
          openCount: answeredThreads.has(thread.key) ? 0 : thread.openCount,
          latestAt: thread.latestAt.toISOString(),
          messages: thread.messages.map((message) => ({
            ...message,
            receivedAt: message.receivedAt.toISOString(),
            acknowledgedAt: message.acknowledgedAt?.toISOString() ?? null,
          })),
        }))}
        orders={orders.map((order) => {
          const financials = (() => {
            if (!order.sourceMetadata) return undefined;
            try {
              return JSON.parse(order.sourceMetadata) as Record<string, string>;
            } catch {
              return undefined;
            }
          })();

          return {
            id: order.id,
            renterName: order.renterName,
            pickupDatetime: order.pickupDatetime.toISOString(),
            returnDatetime: order.returnDatetime.toISOString(),
            pickupLocation: order.pickupLocation,
            returnLocation: order.returnLocation,
            renterPhone: order.renterPhone,
            externalOrderId: order.externalOrderId,
            plateNumber: order.vehicle?.plateNumber ?? null,
            // The plate is what an operator reads before handing over a
            // car, so it is the plate that has to say when it was
            // inferred from a model name rather than stated by Turo.
            plateUnconfirmed: isPlateUnconfirmed(order),
            status: order.status,
            netEarning: getNetEarningFromFinancials(financials, order.totalPrice),
            vehicleLabel: order.vehicle
              ? `${order.vehicle.year} ${order.vehicle.brand} ${order.vehicle.model} · ${order.vehicle.plateNumber}`
              : null,
          };
        })}
      />
    </div>
  );
}
