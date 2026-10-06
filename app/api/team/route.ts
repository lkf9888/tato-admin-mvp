import { NextResponse } from "next/server";

import { canManageTeam } from "@/lib/access";
import { requireCurrentAdminContext } from "@/lib/auth";
import { isEmailConfigured, sendTeamInviteEmail } from "@/lib/email";
import { logActivity } from "@/lib/orders";
import { addMemberWithPassword, createInvite, emailInUse, newMemberSchema } from "@/lib/team";

/**
 * Add someone to the team: with a password set now, or by invitation.
 * Owner only. An invite whose email cannot be sent is still made, and
 * its link returned, so it can be passed on another way.
 */
export async function POST(request: Request) {
  const { workspace, user } = await requireCurrentAdminContext();
  if (!canManageTeam(user)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const parsed = newMemberSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });
  if (await emailInUse(parsed.data.email)) return NextResponse.json({ error: "EMAIL_IN_USE" }, { status: 409 });

  if (parsed.data.password) {
    const member = await addMemberWithPassword({
      workspaceId: workspace.id,
      inviter: user,
      email: parsed.data.email,
      name: parsed.data.name,
      role: parsed.data.role,
      pageAccess: parsed.data.pageAccess,
      password: parsed.data.password,
    });
    await logActivity({
      workspaceId: workspace.id,
      actor: user.name,
      action: "team_member_added",
      entityType: "User",
      entityId: member.id,
      metadata: { email: member.email, role: member.role },
    });
    return NextResponse.json({ ok: true, memberId: member.id });
  }

  const invite = await createInvite({
    workspaceId: workspace.id,
    inviter: user,
    email: parsed.data.email,
    name: parsed.data.name,
    role: parsed.data.role,
    pageAccess: parsed.data.pageAccess,
  });
  const base = (process.env.NEXT_PUBLIC_APP_URL?.trim() || new URL(request.url).origin).replace(/\/$/, "");
  const acceptUrl = `${base}/invite/${invite.token}`;
  const sent = isEmailConfigured()
    ? await sendTeamInviteEmail({
        to: invite.email,
        locale: body?.locale === "en" ? "en" : "zh",
        inviterName: user.name,
        workspaceName: workspace.name,
        acceptUrl,
        replyTo: user.email,
      })
    : { ok: false };
  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: "team_member_invited",
    entityType: "UserInvite",
    entityId: invite.id,
    metadata: { email: invite.email, role: invite.role, emailed: sent.ok },
  });
  return NextResponse.json({ ok: true, inviteId: invite.id, acceptUrl, emailed: sent.ok });
}
