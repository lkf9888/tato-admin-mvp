import { requireCurrentAdminContext } from "@/lib/auth";
import { getI18n } from "@/lib/i18n-server";
import { prisma } from "@/lib/prisma";
import { getAppUrl } from "@/lib/stripe";
import { AgentSetupPanel } from "@/components/agent-setup-panel";

/**
 * API tokens for an AI agent or a script.
 *
 * This page used to hand out the Turo reader, a bookmark that read the
 * operator's own Turo conversations back into TATO. It was removed at
 * the user's request (v1.63.1); an agent with a read-write token records
 * the same conversations through POST /api/agent/messages.
 */
export default async function AgentPage() {
  const [{ messages }, { workspace }] = await Promise.all([
    getI18n(),
    requireCurrentAdminContext(),
  ]);

  const tokens = await prisma.agentToken.findMany({
    where: { workspaceId: workspace.id },
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

  return (
    <AgentSetupPanel
      appUrl={getAppUrl()}
      tokens={tokens.map((token) => ({
        ...token,
        lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
        revokedAt: token.revokedAt?.toISOString() ?? null,
        createdAt: token.createdAt.toISOString(),
      }))}
      title={messages.shell.nav.agent}
    />
  );
}
