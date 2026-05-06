import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { getCurrentAdminUser } from "@/lib/auth";
import { syncOwnerLedger } from "@/lib/owner-ledger";
import { logActivity } from "@/lib/orders";
import { prisma } from "@/lib/prisma";

type Params = Promise<{ ownerId: string }>;

export async function POST(_request: Request, { params }: { params: Params }) {
  const { ownerId } = await params;
  const user = await getCurrentAdminUser();
  if (!user?.workspaceId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const owner = await prisma.owner.findFirst({
    where: { id: ownerId, workspaceId: user.workspaceId },
    select: { id: true, name: true },
  });
  if (!owner) {
    return NextResponse.json({ error: "Owner not found" }, { status: 404 });
  }

  const result = await syncOwnerLedger(owner.id, user.workspaceId);

  await logActivity({
    workspaceId: user.workspaceId,
    actor: user.name,
    action: "owner_ledger_resynced",
    entityType: "Owner",
    entityId: owner.id,
    metadata: result,
  });

  revalidatePath("/owners");
  revalidatePath("/owner-statements");
  return NextResponse.json({ ok: true, ...result });
}
