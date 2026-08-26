import type { Prisma } from "@prisma/client";

import { authenticateAgent } from "@/lib/agent-auth";
import { corsPreflight, withCors } from "@/lib/agent-cors";
import { cursorArgs, iso, paginate, parseLimit } from "@/lib/agent-read";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

/**
 * Saved canned replies.
 *
 * Here because an agent drafting an answer should reach for the
 * wording the operator already settled on rather than inventing a
 * fresh one every time -- house phrasing, the right gate code, the
 * right tone.
 *
 * Filtering by `vehicleId` returns that car's templates *and* the
 * general ones, which is the set actually applicable to a
 * conversation about that car. Returning only the locked ones would
 * be the literal reading of the filter and the wrong answer to the
 * question being asked.
 */
export async function GET(request: Request) {
  const agent = await authenticateAgent(request, "read");
  if (!agent) return withCors({ error: "UNAUTHORIZED" }, { status: 401 });

  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get("limit"));
  const cursor = url.searchParams.get("cursor");
  const vehicleId = url.searchParams.get("vehicleId");

  const where: Prisma.MessageTemplateWhereInput = { workspaceId: agent.workspaceId };
  if (vehicleId) where.OR = [{ vehicleId }, { vehicleId: null }];

  const rows = await prisma.messageTemplate.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...cursorArgs(cursor),
    include: {
      vehicle: { select: { id: true, plateNumber: true, brand: true, model: true, year: true } },
    },
  });

  const { data, nextCursor } = paginate(rows, limit);

  return withCors({
    data: data.map((template) => ({
      id: template.id,
      label: template.label,
      content: template.content,
      /** Null means general -- applicable to any conversation. A
       *  vehicle means the content is only true of that car. */
      vehicle: template.vehicle
        ? {
            id: template.vehicle.id,
            plateNumber: template.vehicle.plateNumber,
            label: `${template.vehicle.year} ${template.vehicle.brand} ${template.vehicle.model}`,
          }
        : null,
      createdAt: iso(template.createdAt),
      updatedAt: iso(template.updatedAt),
    })),
    nextCursor,
  });
}

export function OPTIONS() {
  return corsPreflight();
}
