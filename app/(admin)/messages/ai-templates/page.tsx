import { GuestMessagesTabs } from "@/components/guest-messages-tabs";
import { MessageLibraryView } from "@/components/message-library-view";
import { requireCurrentAdminContext } from "@/lib/auth";
import { getI18n } from "@/lib/i18n-server";
import { isKimiConfigured } from "@/lib/kimi";
import { loadKnowledge, loadVehicleLabels } from "@/lib/message-knowledge-server";

/**
 * The AI message library: saved replies, facts and rules that every AI
 * answering guests reads -- drafting and rewriting here, the assistant,
 * and outside agents through GET /api/agent/message-templates.
 */
export default async function MessageLibraryPage() {
  const [{ locale, messages }, { workspace }] = await Promise.all([getI18n(), requireCurrentAdminContext()]);
  const [entries, vehicles] = await Promise.all([loadKnowledge(workspace.id), loadVehicleLabels(workspace.id)]);
  const t = messages.guestMessagesPage;

  return (
    <div className="space-y-3">
      <h1 className="sr-only">{messages.messageLibrary.title}</h1>
      <GuestMessagesTabs active="library" labels={{ messages: t.tabMessages, library: t.tabLibrary }} />
      <MessageLibraryView locale={locale} initialEntries={entries} vehicles={vehicles} canSuggest={isKimiConfigured()} />
    </div>
  );
}
