import { TuroUpdatesFeed } from "@/components/turo-updates-feed";
import { requireCurrentAdminContext } from "@/lib/auth";
import { getI18n } from "@/lib/i18n-server";
import { loadTuroUpdates } from "@/lib/turo-updates-data";

/**
 * Everything Turo has emailed except guest messages, read like a
 * mailbox: a list sorted by what each mail asks of the operator, and the
 * open one in full beside it.
 *
 * The guest-messages page answers "who is waiting on me". This answers
 * the question the operator used to open their inbox for: what happened,
 * and what Turo needs from them. It acts on as little as it can --
 * marking a request handled -- and sends the rest to the page or the
 * Turo screen that owns it.
 */
export default async function TuroUpdatesPage() {
  const [{ locale, messages }, { workspace }] = await Promise.all([getI18n(), requireCurrentAdminContext()]);

  // Open on what needs doing when there is any, otherwise on everything.
  const first = await loadTuroUpdates(workspace.id, { category: "action" });
  const initialTab = (first.counts?.action ?? 0) > 0 ? "action" : "all";
  const initial =
    initialTab === "action" ? first : { ...(await loadTuroUpdates(workspace.id, { category: "all" })), counts: first.counts };

  return (
    <div className="space-y-3">
      <h1 className="sr-only">{messages.shell.nav.turoUpdates}</h1>
      <TuroUpdatesFeed locale={locale} initial={initial} initialTab={initialTab} />
    </div>
  );
}
