import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "crypto";

import { prisma } from "@/lib/prisma";

/**
 * Credentials for the browser agent.
 *
 * The Gmail sync authenticates with a shared secret in an environment
 * variable, which is fine for a job that runs on infrastructure we
 * control. The browser agent is different: it runs unattended on
 * somebody's laptop, holding a logged-in Turo session, and if that
 * machine is lost the credential has to die without logging the
 * operator out of anything or requiring a redeploy.
 *
 * So: real tokens, stored hashed, individually revocable, with a
 * record of when each was last used.
 */

/**
 * What a token may do.
 *
 * Coarse on purpose -- an agent that can write conversations has no
 * business importing financials. `read` is deliberately separate from
 * both writes rather than implied by them: the common case is an
 * automation that only ever pulls data out, and a credential that can
 * only read is one that cannot be turned into a wrong number by a
 * confused model or a prompt injection carried in a guest's message.
 */
export const AGENT_SCOPES = ["read", "messages:write", "orders:write"] as const;
export type AgentScope = (typeof AGENT_SCOPES)[number];

function hashToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Mint a token. The plaintext is returned once and never stored --
 * a leaked database should hand over data, not working credentials.
 */
export async function createAgentToken(input: {
  workspaceId: string;
  name: string;
  scopes: AgentScope[];
  createdBy: string;
}) {
  // 32 bytes of randomness, base64url. Prefixed so a token found in a
  // log or a shell history is recognisable as one.
  const token = `tato_${randomBytes(32).toString("base64url")}`;

  const record = await prisma.agentToken.create({
    data: {
      workspaceId: input.workspaceId,
      name: input.name.slice(0, 80),
      tokenHash: hashToken(token),
      tokenPrefix: token.slice(0, 13),
      scopes: input.scopes.join(","),
      createdBy: input.createdBy,
    },
  });

  return { token, record };
}

export type AgentContext = {
  workspaceId: string;
  tokenId: string;
  name: string;
  scopes: AgentScope[];
};

/**
 * Resolve the caller, or null.
 *
 * Looks the token up by hash rather than scanning: a constant-time
 * compare over every row would be slower and no safer, since the hash
 * is what the index is on. The compare below still runs in constant
 * time against the stored hash, so a timing signal cannot distinguish
 * "no such token" from "wrong token" once a row is found.
 */
export async function authenticateAgent(
  request: Request,
  required: AgentScope,
): Promise<AgentContext | null> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token.startsWith("tato_")) return null;

  const digest = hashToken(token);
  const record = await prisma.agentToken.findUnique({ where: { tokenHash: digest } });
  if (!record || record.revokedAt) return null;

  const supplied = Buffer.from(digest, "utf8");
  const stored = Buffer.from(record.tokenHash, "utf8");
  if (supplied.length !== stored.length || !timingSafeEqual(supplied, stored)) return null;

  const scopes = record.scopes.split(",").filter(Boolean) as AgentScope[];
  if (!scopes.includes(required)) return null;

  // Best-effort: a failed write here must not fail the request it is
  // recording.
  await prisma.agentToken
    .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
    .catch(() => null);

  return {
    workspaceId: record.workspaceId,
    tokenId: record.id,
    name: record.name,
    scopes,
  };
}

/** Stable id for a message the page did not give one to. Content-based,
 *  so re-scraping the same conversation updates rather than duplicates,
 *  and an edited message is correctly a different one. */
export function messageFingerprint(input: {
  direction: string;
  sentAt: string;
  body: string;
}) {
  return createHash("sha256")
    .update(`${input.direction}|${input.sentAt}|${input.body.trim()}`, "utf8")
    .digest("hex")
    .slice(0, 32);
}
