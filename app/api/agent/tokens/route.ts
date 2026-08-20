import { NextResponse } from "next/server";
import { z } from "zod";

import { AGENT_SCOPES, createAgentToken, type AgentScope } from "@/lib/agent-auth";
import { requireCurrentAdminContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  scopes: z.array(z.enum(AGENT_SCOPES)).min(1),
});

/** List tokens. Prefixes only -- enough to tell them apart, not enough
 *  to use one. */
export async function GET() {
  let context;
  try {
    context = await requireCurrentAdminContext();
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const tokens = await prisma.agentToken.findMany({
    where: { workspaceId: context.workspace.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      tokenPrefix: true,
      scopes: true,
      lastUsedAt: true,
      revokedAt: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ tokens });
}

/**
 * Mint one.
 *
 * The plaintext is in this response and nowhere else, ever. Losing it
 * means minting another, which is the correct trade: a token that can
 * be recovered from the database is a token an attacker can recover
 * from the database.
 */
export async function POST(request: Request) {
  let context;
  try {
    context = await requireCurrentAdminContext();
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });
  }

  const { token, record } = await createAgentToken({
    workspaceId: context.workspace.id,
    name: parsed.data.name,
    scopes: parsed.data.scopes as AgentScope[],
    createdBy: context.user.name,
  });

  return NextResponse.json({
    token,
    id: record.id,
    name: record.name,
    prefix: record.tokenPrefix,
    note: "Copy this now. It is not stored and cannot be shown again.",
  });
}

const revokeSchema = z.object({ id: z.string().trim().min(1) });

export async function DELETE(request: Request) {
  let context;
  try {
    context = await requireCurrentAdminContext();
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const parsed = revokeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });
  }

  const updated = await prisma.agentToken.updateMany({
    where: { id: parsed.data.id, workspaceId: context.workspace.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  if (updated.count === 0) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
