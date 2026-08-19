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
      vehicle: { select: { brand: true, model: true, year: true, plateNumber: true } },
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

      return {
        id: email.id,
        subject: email.subject,
        guestName: email.guestName,
        vehicleId: email.vehicleId,
        vehicleLabel: email.vehicle
          ? `${email.vehicle.year} ${email.vehicle.brand} ${email.vehicle.model}`
          : null,
        receivedAt: email.receivedAt,
        acknowledgedAt: email.acknowledgedAt,
        turoLink: email.turoLink,
        orderId: email.orderId,
        summary: extracted?.summary ?? null,
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
      <header className="rounded-lg border border-[var(--line)] bg-[var(--panel-strong)] px-3 py-3 shadow-sm sm:px-4">
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
