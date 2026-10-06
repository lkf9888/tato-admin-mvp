import "server-only";

import { prisma } from "@/lib/prisma";

/**
 * Standing instructions for the AI.
 *
 * Things the operator would otherwise repeat in every request -- "keep
 * replies short", "pickup is in lot B2, not at the airport" -- said once
 * and added to every assistant answer and every guest-reply draft.
 * Plain sentences, kept short and few, because every one of them is
 * read on every request.
 */

export const MEMORY_MAX_ITEMS = 30;
export const MEMORY_MAX_CHARS = 300;

export async function listAssistantMemory(workspaceId: string) {
  return prisma.assistantMemory.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "asc" },
    select: { id: true, content: true, createdAt: true },
  });
}

export async function addAssistantMemory(input: { workspaceId: string; content: string; createdBy?: string }) {
  const content = input.content.replace(/\s+/g, " ").trim().slice(0, MEMORY_MAX_CHARS);
  if (!content) return { ok: false as const, error: "EMPTY" };
  const count = await prisma.assistantMemory.count({ where: { workspaceId: input.workspaceId } });
  if (count >= MEMORY_MAX_ITEMS) return { ok: false as const, error: "TOO_MANY" };
  await prisma.assistantMemory.create({
    data: { workspaceId: input.workspaceId, content, createdBy: input.createdBy ?? null },
  });
  return { ok: true as const };
}

export async function removeAssistantMemory(input: { workspaceId: string; id: string }) {
  await prisma.assistantMemory.deleteMany({ where: { workspaceId: input.workspaceId, id: input.id } });
}

/** The block added to a prompt, or "" when there is nothing remembered. */
export async function assistantMemoryPrompt(workspaceId: string) {
  const items = await listAssistantMemory(workspaceId);
  if (items.length === 0) return "";
  return [
    "Standing instructions from the operator (follow them unless the request says otherwise):",
    ...items.map((item) => `- ${item.content}`),
  ].join("\n");
}
