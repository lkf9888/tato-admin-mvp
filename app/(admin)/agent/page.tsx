import { requireCurrentAdminContext } from "@/lib/auth";
import { getI18n } from "@/lib/i18n-server";
import { prisma } from "@/lib/prisma";
import { getAppUrl } from "@/lib/stripe";
import { buildBookmarkletSource } from "@/lib/turo-bookmarklet";
import { AgentSetupPanel } from "@/components/agent-setup-panel";

/**
 * Setting up the Turo reader.
 *
 * The thing this page hands out is a bookmark, which is an unusual
 * answer and worth the paragraph explaining why it is the right one:
 * Turo sits behind Cloudflare, and every automated browser pointed at
 * it was blocked -- bundled Chromium and the real Chrome binary,
 * headed and headless alike. What it recognises is the automation
 * connection itself.
 *
 * A person clicking a bookmark in the browser they are already signed
 * into is not a disguise. It is the operator reading their own
 * conversations, with the reading written down afterwards.
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
      lastUsedAt: true,
      revokedAt: true,
      createdAt: true,
    },
  });

  const scraped = await prisma.turoConversationMessage.count({
    where: { workspaceId: workspace.id },
  });
  const outbound = await prisma.turoConversationMessage.count({
    where: { workspaceId: workspace.id, direction: "outbound" },
  });

  return (
    <AgentSetupPanel
      bookmarklet={`javascript:${encodeURIComponent(buildBookmarkletSource(getAppUrl()))}`}
      tokens={tokens.map((token) => ({
        ...token,
        lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
        revokedAt: token.revokedAt?.toISOString() ?? null,
        createdAt: token.createdAt.toISOString(),
      }))}
      stats={{ scraped, outbound }}
      title={messages.shell.nav.agent}
    />
  );
}
