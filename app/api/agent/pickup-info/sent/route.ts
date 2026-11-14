import { authenticateAgent } from "@/lib/agent-auth";
import { corsPreflight, withCors } from "@/lib/agent-cors";
import { iso } from "@/lib/agent-read";
import { pickupSentSchema, recordPickupInfoSent } from "@/lib/order-pickup-info";

export const runtime = "nodejs";

/**
 * The phone assistant reports it sent a trip's pickup message. The first
 * report stands; repeating it returns alreadySent and changes nothing.
 */
export async function POST(request: Request) {
  const agent = await authenticateAgent(request, "orders:write");
  if (!agent) return withCors({ error: "UNAUTHORIZED" }, { status: 401 });

  const parsed = pickupSentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return withCors({ error: "VALIDATION_ERROR", issues: parsed.error.issues.slice(0, 5) }, { status: 400 });
  }

  const result = await recordPickupInfoSent(agent.workspaceId, parsed.data, agent.name);
  if (!result.ok) return withCors({ error: result.error }, { status: 404 });
  return withCors({ ok: true, alreadySent: result.alreadySent, sentAt: iso(result.sentAt) });
}

export function OPTIONS() {
  return corsPreflight();
}
