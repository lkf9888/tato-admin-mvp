import { NextResponse } from "next/server";

import { canManageTeam } from "@/lib/access";
import { requireCurrentAdminContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type Params = Promise<{ inviteId: string }>;

/** Withdraw an invite; its link stops working. */
export async function DELETE(_request: Request, { params }: { params: Params }) {
  const { inviteId } = await params;
  const { workspace, user } = await requireCurrentAdminContext();
  if (!canManageTeam(user)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  await prisma.userInvite.deleteMany({ where: { id: inviteId, workspaceId: workspace.id, acceptedAt: null } });
  return NextResponse.json({ ok: true });
}
