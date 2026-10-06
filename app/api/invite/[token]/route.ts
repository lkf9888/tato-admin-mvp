import { NextResponse } from "next/server";
import { z } from "zod";

import { setAdminSession } from "@/lib/auth";
import { logActivity } from "@/lib/orders";
import { acceptInvite } from "@/lib/team";

type Params = Promise<{ token: string }>;

const bodySchema = z.object({ name: z.string().trim().min(1).max(80), password: z.string().min(8).max(200) });

/** Accept a team invite: create the account and sign it in. */
export async function POST(request: Request, { params }: { params: Params }) {
  const { token } = await params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });
  const result = await acceptInvite(token, parsed.data);
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: result.reason === "EMAIL_IN_USE" ? 409 : 404 });
  await setAdminSession(result.user.id);
  await logActivity({
    workspaceId: result.user.workspaceId!,
    actor: result.user.name,
    action: "team_invite_accepted",
    entityType: "User",
    entityId: result.user.id,
    metadata: { email: result.user.email, role: result.user.role },
  });
  return NextResponse.json({ ok: true });
}
