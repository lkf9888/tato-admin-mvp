import { NextResponse } from "next/server";
import { z } from "zod";

import { canManageTeam } from "@/lib/access";
import { requireCurrentAdminContext } from "@/lib/auth";
import { logActivity } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import { findEditableMember, memberRoleSchema, pageAccessSchema, updateMember } from "@/lib/team";

type Params = Promise<{ userId: string }>;

const bodySchema = z.object({ role: memberRoleSchema, pageAccess: pageAccessSchema });

/** Change a member's role and pages. Owner only; never an owner, never yourself. */
export async function PATCH(request: Request, { params }: { params: Params }) {
  const { userId } = await params;
  const { workspace, user } = await requireCurrentAdminContext();
  if (!canManageTeam(user)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const member = await findEditableMember(workspace.id, userId, user.id);
  if (!member) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });
  await updateMember(member.id, parsed.data);
  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: "team_member_updated",
    entityType: "User",
    entityId: member.id,
    metadata: { email: member.email, role: parsed.data.role, pages: parsed.data.pageAccess.length },
  });
  return NextResponse.json({ ok: true });
}

/** Remove a member. Their sign-in stops working at once. */
export async function DELETE(_request: Request, { params }: { params: Params }) {
  const { userId } = await params;
  const { workspace, user } = await requireCurrentAdminContext();
  if (!canManageTeam(user)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  const member = await findEditableMember(workspace.id, userId, user.id);
  if (!member) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  await prisma.user.delete({ where: { id: member.id } });
  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: "team_member_removed",
    entityType: "User",
    entityId: member.id,
    metadata: { email: member.email },
  });
  return NextResponse.json({ ok: true });
}
