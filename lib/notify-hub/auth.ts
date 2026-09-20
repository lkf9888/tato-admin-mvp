import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "crypto";

import { prisma } from "@/lib/prisma";

/**
 * Credentials for a sending system.
 *
 * The same shape as the browser agent's tokens, for the same reason
 * and one more: the wash bay's key lives on a machine in a car park
 * that nobody watches. Losing it must not mean rotating HostHub's
 * credential, and revoking it must not require a deploy -- so keys are
 * rows, scoped to one app, individually revocable.
 */

const KEY_PREFIX = "ntfy_";

export type NotifyAppContext = {
  appId: string;
  appKey: string;
  appName: string;
  miniProgramId: string;
  apiKeyId: string;
};

function hashKey(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Mint a key. The plaintext is returned once and never stored. */
export async function createNotifyApiKey(input: { appId: string; name: string }) {
  const token = `${KEY_PREFIX}${randomBytes(32).toString("base64url")}`;

  const record = await prisma.notifyApiKey.create({
    data: {
      appId: input.appId,
      name: input.name.slice(0, 80),
      tokenHash: hashKey(token),
      tokenPrefix: token.slice(0, 13),
    },
  });

  return { token, record };
}

export async function revokeNotifyApiKey(apiKeyId: string) {
  return prisma.notifyApiKey.update({
    where: { id: apiKeyId },
    data: { revokedAt: new Date() },
  });
}

/**
 * Resolve the calling system, or null.
 *
 * Returns the app's mini program alongside its id because every
 * downstream decision -- which templates exist, which quota pool a
 * send draws from, which appid signs the request -- follows from it,
 * and a handler that had to look it up separately would be a handler
 * that could forget to.
 */
export async function authenticateNotifyApp(request: Request): Promise<NotifyAppContext | null> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token.startsWith(KEY_PREFIX)) return null;

  const digest = hashKey(token);
  const record = await prisma.notifyApiKey.findUnique({
    where: { tokenHash: digest },
    include: { app: true },
  });
  if (!record || record.revokedAt || !record.app.isActive) return null;

  const supplied = Buffer.from(digest, "utf8");
  const stored = Buffer.from(record.tokenHash, "utf8");
  if (supplied.length !== stored.length || !timingSafeEqual(supplied, stored)) return null;

  // Best effort: a failed write here must not fail the send it is
  // recording.
  await prisma.notifyApiKey
    .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
    .catch(() => null);

  return {
    appId: record.app.id,
    appKey: record.app.key,
    appName: record.app.name,
    miniProgramId: record.app.miniProgramId,
    apiKeyId: record.id,
  };
}
