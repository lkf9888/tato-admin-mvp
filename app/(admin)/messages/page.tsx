import { GuestMessagesTabs } from "@/components/guest-messages-tabs";
import { GuestMessagesView } from "@/components/guest-messages-view";
import { requireCurrentAdminContext } from "@/lib/auth";
import { loadGuestMessagesPage } from "@/lib/guest-messages-data";
import { getI18n } from "@/lib/i18n-server";
import { isKimiConfigured } from "@/lib/kimi";
import { loadKnowledge } from "@/lib/message-knowledge-server";
import { prisma } from "@/lib/prisma";

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

  const fleet = await prisma.vehicle.findMany({
    where: { workspaceId: workspace.id },
    select: { id: true, brand: true, model: true, year: true, nickname: true, plateNumber: true },
  });

  // "PLATE · Nickname" everywhere a vehicle needs a short, unambiguous
  // name -- the same shape the order and owner pages already use.
  const vehicleLabel = (vehicle: (typeof fleet)[number]) =>
    `${vehicle.plateNumber} · ${vehicle.nickname || `${vehicle.brand} ${vehicle.model} ${vehicle.year}`}`;

  // Rules are guidance for the AI, never words for a guest, so the
  // scheduled-message rules cannot pick one.
  const messageTemplates = await prisma.messageTemplate.findMany({
    where: { workspaceId: workspace.id, kind: { not: "rule" } },
    orderBy: { createdAt: "desc" },
  });
  const library = await loadKnowledge(workspace.id);
  const fleetById = new Map(fleet.map((vehicle) => [vehicle.id, vehicle]));

  // The newest page of conversations. Older ones load as the operator
  // scrolls (/api/messages/threads): ten years of history no longer
  // fits in one page load.
  const firstPage = await loadGuestMessagesPage(workspace.id);

  return (
    <div className="space-y-2">
      <h1 className="sr-only">{messages.shell.nav.guestMessages}</h1>
      {/* On a phone the library is a button in the top bar, so the list
          starts at the top of the screen. */}
      <div className="hidden lg:block">
        <GuestMessagesTabs
          active="messages"
          labels={{ messages: messages.guestMessagesPage.tabMessages, library: messages.guestMessagesPage.tabLibrary }}
        />
      </div>

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
        library={library}
        vehicleLabels={Object.fromEntries(fleet.map((vehicle) => [vehicle.id, vehicleLabel(vehicle)]))}
        templateVehicleOptions={fleet.map((vehicle) => ({
          id: vehicle.id,
          label: vehicleLabel(vehicle),
          searchText: [vehicle.plateNumber, vehicle.nickname, vehicle.brand, vehicle.model, String(vehicle.year)]
            .filter(Boolean)
            .join(" "),
        }))}
        firstPage={firstPage}
      />
    </div>
  );
}
