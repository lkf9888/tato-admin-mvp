import { TuroTasksView } from "@/components/turo-tasks-view";
import { getTuroTaskFeed, listOpenTuroTasks } from "@/lib/agent-turo-tasks";
import { requireCurrentAdminContext } from "@/lib/auth";
import { getI18n } from "@/lib/i18n-server";

/**
 * What is still undone on Turo trips, as the phone assistant last read
 * it from the Turo app: check-in photos and licences before pickup,
 * check-outs and claims after return, invoices waiting on the guest.
 * TATO decides none of it (see lib/agent-turo-tasks); this page only
 * shows the list and how fresh it is, since a phone that went offline
 * leaves a list that looks finished and is not.
 */
export default async function TuroTasksPage() {
  const [{ locale, messages }, { workspace }] = await Promise.all([getI18n(), requireCurrentAdminContext()]);
  const [tasks, feed] = await Promise.all([listOpenTuroTasks(workspace.id), getTuroTaskFeed(workspace.id)]);

  return (
    <div className="space-y-3">
      <h1 className="sr-only">{messages.turoTasks.title}</h1>
      <TuroTasksView
        locale={locale}
        feed={feed ? { lastPushAt: feed.lastPushAt.toISOString(), stale: feed.stale } : null}
        tasks={tasks.map((task) => ({
          id: task.id,
          code: task.code,
          stage: task.stage,
          title: task.title,
          brief: task.brief,
          plate: task.plate,
          orderId: task.orderId,
          turoUrl: task.turoUrl,
          dueAt: task.dueAt?.toISOString() ?? null,
          severity: task.severity,
          remindCount: task.remindCount,
        }))}
      />
    </div>
  );
}
