import { NextResponse } from "next/server";

import { requireCurrentAdminContext } from "@/lib/auth";
import { isEmailConfigured, sendOwnerStatementEmail } from "@/lib/email";
import { logActivity } from "@/lib/orders";
import { ensureOwnerShareLink } from "@/lib/owner-share-link";
import { prisma } from "@/lib/prisma";

type Params = Promise<{ ownerId: string }>;

/**
 * Email the owner that their statement is ready, with the link to their
 * read-only ledger.
 *
 * The link is made here if the owner has none -- a reminder pointing
 * nowhere is the one failure this must not have -- and kept if they do,
 * so a link from an earlier email still works. Each failure says which
 * thing is missing, so the dialog can tell the operator what to fix.
 */
export async function POST(request: Request, { params }: { params: Params }) {
  const { ownerId } = await params;
  const { workspace, user } = await requireCurrentAdminContext();

  const owner = await prisma.owner.findFirst({
    where: { id: ownerId, workspaceId: workspace.id },
    select: { id: true, name: true, email: true },
  });
  if (!owner) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const to = owner.email?.trim();
  if (!to) return NextResponse.json({ error: "NO_RECIPIENT" }, { status: 400 });
  if (!isEmailConfigured()) return NextResponse.json({ error: "EMAIL_NOT_CONFIGURED" }, { status: 400 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const note = typeof body.note === "string" ? body.note.slice(0, 2000) : null;
  const locale = body.locale === "en" ? "en" : "zh";

  const { token } = await ensureOwnerShareLink({
    workspaceId: workspace.id,
    ownerId: owner.id,
    createdBy: user.name,
  });
  const base = (process.env.NEXT_PUBLIC_APP_URL?.trim() || new URL(request.url).origin).replace(/\/$/, "");

  const sent = await sendOwnerStatementEmail({
    to,
    locale,
    ownerName: owner.name,
    operatorName: workspace.name?.trim() || "TATO",
    statementUrl: `${base}/share/${token}`,
    note,
    replyTo: user.email,
  });
  if (!sent.ok) {
    return NextResponse.json({ error: "SEND_FAILED", detail: sent.reason ?? null }, { status: 502 });
  }

  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: "owner_statement_emailed",
    entityType: "Owner",
    entityId: owner.id,
    metadata: { to, locale, withNote: Boolean(note) },
  });
  return NextResponse.json({ ok: true, sentTo: to });
}
