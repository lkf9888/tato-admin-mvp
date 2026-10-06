import { GuestMessagesView } from "@/components/guest-messages-view";
import { requireCurrentAdminContext } from "@/lib/auth";
import { loadGuestThreads } from "@/lib/guest-thread-state";
import { getI18n } from "@/lib/i18n-server";
import { isKimiConfigured } from "@/lib/kimi";
import { prisma } from "@/lib/prisma";
import { classifyTuroSubject } from "@/lib/turo-subjects";
import { matchVehiclesForEmail } from "@/lib/turo-message-match";
import { isPlateUnconfirmed } from "@/lib/vehicle-assignment";
import { getNetEarningFromFinancials, turoReservationUrl } from "@/lib/utils";

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

  // "PLATE · Nickname" everywhere a vehicle needs a short, unambiguous
  // name -- the same shape the order and owner pages already use.
  const vehicleLabel = (vehicle: (typeof fleet)[number]) =>
    `${vehicle.plateNumber} · ${vehicle.nickname || `${vehicle.brand} ${vehicle.model} ${vehicle.year}`}`;

  const messageTemplates = await prisma.messageTemplate.findMany({
    where: { workspaceId: workspace.id },
    orderBy: { createdAt: "desc" },
  });
  const fleetById = new Map(fleet.map((vehicle) => [vehicle.id, vehicle]));

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

  // Threads and which are already answered, from the same function the
  // nav badge counts with, so the two numbers cannot disagree.
  const { threads, scraped, reservationIds, answeredKeys: answeredThreads } = await loadGuestThreads(
    workspace.id,
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
          vehicle: { select: { brand: true, model: true, year: true, plateNumber: true, pickupPassword: true } },
        },
      })
    : [];

  return (
    <div>
      <h1 className="sr-only">{messages.shell.nav.guestMessages}</h1>

      <GuestMessagesView
        locale={locale}
        canDraft={isKimiConfigured()}
        messageTemplates={messageTemplates.map((template) => {
          const vehicle = template.vehicleId ? fleetById.get(template.vehicleId) : null;
          return {
            id: template.id,
            label: template.label,
            content: template.content,
            vehicleId: template.vehicleId,
            vehicleLabel: vehicle ? vehicleLabel(vehicle) : null,
          };
        })}
        templateVehicleOptions={fleet.map((vehicle) => ({
          id: vehicle.id,
          label: vehicleLabel(vehicle),
          searchText: [vehicle.plateNumber, vehicle.nickname, vehicle.brand, vehicle.model, String(vehicle.year)]
            .filter(Boolean)
            .join(" "),
        }))}
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
            turoMessagesUrl: turoReservationUrl(order, "messages"),
            // For message templates' {{car}} and {{pickup_code}}. The
            // code is the operator's own, on an admin-only page.
            vehicleName: order.vehicle ? `${order.vehicle.brand} ${order.vehicle.model} ${order.vehicle.year}` : null,
            pickupCode: order.vehicle?.pickupPassword ?? null,
          };
        })}
      />
    </div>
  );
}
