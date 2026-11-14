import { authenticateAgent } from "@/lib/agent-auth";
import { corsPreflight, withCors } from "@/lib/agent-cors";
import { iso } from "@/lib/agent-read";
import { readPickupInfoForAgent } from "@/lib/order-pickup-info";

export const runtime = "nodejs";

/** One call asks about a morning's pickups, not the whole history. */
const MAX_RESERVATIONS = 50;

/**
 * The pickup message staff prepared for each of these reservations
 * (lib/order-pickup-info.ts), for the phone assistant to send once the
 * guest has uploaded their licence. Only reservations with pickup info
 * come back; `message` is the full text, and only when staff marked that
 * exact text ready.
 *
 * Behind orders:write rather than read: the text holds the lockbox code,
 * and a read-only token handed to some reporting script must not be
 * able to open a car.
 */
export async function GET(request: Request) {
  const agent = await authenticateAgent(request, "orders:write");
  if (!agent) return withCors({ error: "UNAUTHORIZED" }, { status: 401 });

  const reservationIds = [
    ...new Set(
      (new URL(request.url).searchParams.get("reservationIds") ?? "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  ];
  if (reservationIds.length === 0 || reservationIds.length > MAX_RESERVATIONS) {
    return withCors({ error: "VALIDATION_ERROR", detail: `1 to ${MAX_RESERVATIONS} reservationIds` }, { status: 400 });
  }

  const rows = await readPickupInfoForAgent(agent.workspaceId, reservationIds);
  return withCors({
    data: rows.map((row) => ({ ...row, updatedAt: iso(row.updatedAt), sentAt: iso(row.sentAt) })),
  });
}

export function OPTIONS() {
  return corsPreflight();
}
