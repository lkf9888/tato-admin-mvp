import { authenticateAgent } from "@/lib/agent-auth";
import { corsPreflight, withCors } from "@/lib/agent-cors";
import { iso } from "@/lib/agent-read";
import { applyTuroTaskPush, getTuroTaskFeed, listOpenTuroTasks, turoTaskPushSchema } from "@/lib/agent-turo-tasks";

export const runtime = "nodejs";

/**
 * The phone assistant's open Turo tasks: check-in, licence, photos,
 * checkout, fees to invoice, late returns -- what only the Turo app
 * shows. POST replaces the whole list (codes missing from it close);
 * GET reads back what TATO holds. Behind orders:write and read, the
 * scopes the assistant's token already carries for trips.
 */
export async function POST(request: Request) {
  const agent = await authenticateAgent(request, "orders:write");
  if (!agent) return withCors({ error: "UNAUTHORIZED" }, { status: 401 });

  const parsed = turoTaskPushSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return withCors({ error: "VALIDATION_ERROR", issues: parsed.error.issues.slice(0, 5) }, { status: 400 });
  }

  const result = await applyTuroTaskPush(agent.workspaceId, parsed.data, agent.name);
  return withCors(result);
}

export async function GET(request: Request) {
  const agent = await authenticateAgent(request, "read");
  if (!agent) return withCors({ error: "UNAUTHORIZED" }, { status: 401 });

  const [tasks, feed] = await Promise.all([listOpenTuroTasks(agent.workspaceId), getTuroTaskFeed(agent.workspaceId)]);
  return withCors({
    feed: feed
      ? {
          lastPushAt: iso(feed.lastPushAt),
          generatedAt: iso(feed.generatedAt),
          openCount: feed.openCount,
          stale: feed.stale,
        }
      : null,
    data: tasks.map((task) => ({
      code: task.code,
      kind: task.kind,
      stage: task.stage,
      title: task.title,
      brief: task.brief,
      reservationId: task.reservationId,
      orderId: task.orderId,
      plate: task.plate,
      dueAt: iso(task.dueAt),
      severity: task.severity,
      turoUrl: task.turoUrl,
      openedAt: iso(task.openedAt),
      remindCount: task.remindCount,
    })),
  });
}

export function OPTIONS() {
  return corsPreflight();
}
