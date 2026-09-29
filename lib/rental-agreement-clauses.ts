import "server-only";

import { prisma } from "@/lib/prisma";
import {
  RENTAL_AGREEMENT_CLAUSES,
  type RentalAgreementClause,
} from "@/lib/rental-agreement-text";

/**
 * The agreement's clauses as a workspace has worded them.
 *
 * One set per workspace, for every car it rents. The built-in wording
 * is the default and is never copied in: a workspace that has not
 * edited anything keeps following it, and "restore default" is just
 * deleting the row.
 */

export const AGREEMENT_CLAUSE_LIMITS = { count: 40, heading: 120, body: 5000 } as const;

/** Tidy a list of clauses; rows with no body are dropped. */
export function normalizeAgreementClauses(
  rows: Array<{ heading?: unknown; body?: unknown }>,
): RentalAgreementClause[] {
  return rows
    .map((row) => ({
      heading: typeof row.heading === "string" ? row.heading.trim().slice(0, AGREEMENT_CLAUSE_LIMITS.heading) : "",
      body: typeof row.body === "string" ? row.body.trim().slice(0, AGREEMENT_CLAUSE_LIMITS.body) : "",
    }))
    .filter((row) => row.body)
    .slice(0, AGREEMENT_CLAUSE_LIMITS.count);
}

function parseStored(raw: string): RentalAgreementClause[] | null {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const clauses = normalizeAgreementClauses(parsed);
    return clauses.length > 0 ? clauses : null;
  } catch {
    return null;
  }
}

export async function getWorkspaceAgreementClauses(workspaceId: string) {
  const row = await prisma.rentalAgreementClauseSet.findUnique({ where: { workspaceId } });
  const custom = row ? parseStored(row.clauses) : null;
  return {
    clauses: custom ?? RENTAL_AGREEMENT_CLAUSES,
    isCustom: custom != null,
    updatedAt: row?.updatedAt ?? null,
  };
}
