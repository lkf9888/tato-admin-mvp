import { GuestMessagesView } from "@/components/guest-messages-view";
import { requireCurrentAdminContext } from "@/lib/auth";
import { groupIntoThreads } from "@/lib/guest-threads";
import { getI18n } from "@/lib/i18n-server";
import { isKimiConfigured } from "@/lib/kimi";
import { prisma } from "@/lib/prisma";
import { getNetEarningFromFinancials } from "@/lib/utils";

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
          vehicle: { select: { brand: true, model: true, year: true, plateNumber: true } },
        },
      })
    : [];

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
