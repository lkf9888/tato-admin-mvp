import "server-only";

import { prisma } from "@/lib/prisma";

/**
 * Names the operator gives their Turo accounts.
 *
 * The account itself is a string on each car (`Vehicle.turoAccount`,
 * null for the main account) and it is not ours to rename: it is how
 * Turo's mail names the co-host -- "(kevin's vehicles) - ..." -- and
 * the matcher compares against exactly that. Renaming it on the cars
 * would quietly stop every later email from that account finding its
 * car. So a name is a label laid over the key, kept per workspace, and
 * shown wherever an account is picked.
 */

export const ACCOUNT_LABEL_MAX = 40;

export async function loadAccountLabels(workspaceId: string): Promise<Record<string, string>> {
  const config = await prisma.turoSyncConfig.findUnique({
    where: { workspaceId },
    select: { accountLabels: true },
  });
  if (!config?.accountLabels) return {};
  try {
    const parsed = JSON.parse(config.accountLabels) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim() !== "",
      ),
    );
  } catch {
    return {};
  }
}

/** Set or clear (empty label) one account's name. `account` "" is the main account. */
export async function saveAccountLabel(workspaceId: string, account: string, label: string) {
  const labels = await loadAccountLabels(workspaceId);
  const key = account.trim();
  const value = label.trim().slice(0, ACCOUNT_LABEL_MAX);
  if (value) labels[key] = value;
  else delete labels[key];
  const accountLabels = Object.keys(labels).length > 0 ? JSON.stringify(labels) : null;
  await prisma.turoSyncConfig.upsert({
    where: { workspaceId },
    create: { workspaceId, accountLabels },
    update: { accountLabels },
  });
  return labels;
}
