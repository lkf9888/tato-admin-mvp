import "server-only";

import { prisma } from "@/lib/prisma";

/**
 * The Turo CSV row an order was imported from, and which of its columns
 * the order page shows.
 *
 * Imports keep the whole row (`sourceMetadata.rawRow`) whatever the
 * mapping read from it, so every column Turo exports is already in the
 * system. Showing or hiding a column is a display choice, made once for
 * the workspace -- the same columns matter on every trip.
 */

const MAX_HIDDEN = 200;

export function readCsvRow(sourceMetadata: string | null | undefined): Array<[string, string]> | null {
  if (!sourceMetadata) return null;
  try {
    const parsed = JSON.parse(sourceMetadata) as { rawRow?: unknown };
    const row = parsed.rawRow;
    if (!row || typeof row !== "object" || Array.isArray(row)) return null;
    const entries = Object.entries(row as Record<string, unknown>)
      .filter(([column]) => column.trim() !== "")
      .map(([column, value]): [string, string] => [column, value == null ? "" : String(value).trim()]);
    return entries.length > 0 ? entries : null;
  } catch {
    return null;
  }
}

export async function getHiddenCsvColumns(workspaceId: string): Promise<string[]> {
  const setting = await prisma.turoCsvDisplaySetting.findUnique({
    where: { workspaceId },
    select: { hiddenColumns: true },
  });
  return parseColumns(setting?.hiddenColumns);
}

export async function saveHiddenCsvColumns(workspaceId: string, columns: string[]) {
  const cleaned = [...new Set(columns.map((column) => column.trim()).filter(Boolean))]
    .map((column) => column.slice(0, 120))
    .slice(0, MAX_HIDDEN);
  const hiddenColumns = JSON.stringify(cleaned);
  await prisma.turoCsvDisplaySetting.upsert({
    where: { workspaceId },
    create: { workspaceId, hiddenColumns },
    update: { hiddenColumns },
  });
  return cleaned;
}

function parseColumns(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((column): column is string => typeof column === "string") : [];
  } catch {
    return [];
  }
}
