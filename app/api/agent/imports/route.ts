import { z } from "zod";

import { authenticateAgent } from "@/lib/agent-auth";
import { corsPreflight, withCors } from "@/lib/agent-cors";
import { logActivity } from "@/lib/orders";
import { importTuroCsvText, TuroSyncError } from "@/lib/turo-sync";

export const runtime = "nodejs";

/**
 * Turo's trip-earnings CSV, uploaded by an agent.
 *
 * The same import the CSV page and the scheduled sync run -- this route
 * only authenticates and hands over the text. That is deliberate: the
 * CSV is the one source that names the plate and settles the money, so
 * everything that makes it trustworthy (plate-first matching, the
 * identifier reclaim, the owner ledger, cancelled trips archived) has
 * to be the code a person's upload goes through, not a second copy of it.
 *
 * Never creates vehicles. A car is a billing slot and an owner
 * relationship; a row for a plate the fleet does not have comes back
 * as a failure for a person to look at.
 */
const payloadSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  /** The file's text exactly as Turo exported it. A full year's export
   *  for a fleet this size is a few hundred KB; the cap is generous. */
  csv: z.string().min(1).max(5_000_000),
  /** Co-host account the export came from, as Turo names it. Omitted
   *  or blank is the main account. */
  turoAccount: z.string().trim().max(80).nullish(),
});

/** Enough failures to act on without echoing a whole file back. */
const MAX_FAILURES_RETURNED = 50;

export async function POST(request: Request) {
  const agent = await authenticateAgent(request, "orders:write");
  if (!agent) return withCors({ error: "UNAUTHORIZED" }, { status: 401 });

  const parsed = payloadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return withCors(
      { error: "VALIDATION_ERROR", detail: parsed.error.issues.slice(0, 3) },
      { status: 400 },
    );
  }

  const actor = `agent:${agent.name}`;

  try {
    const result = await importTuroCsvText({
      workspaceId: agent.workspaceId,
      actor,
      fileName: parsed.data.fileName,
      content: parsed.data.csv,
      turoAccount: parsed.data.turoAccount ?? null,
      createMissingVehicles: false,
    });

    // The import logs itself as the actor; this records which token did
    // it, so a bad upload can be traced to the credential to revoke.
    await logActivity({
      workspaceId: agent.workspaceId,
      actor,
      action: "agent_import_csv",
      entityType: "ImportBatch",
      entityId: result.batchId,
      metadata: { tokenId: agent.tokenId, fileName: result.fileName },
    });

    return withCors({
      ok: true,
      batchId: result.batchId,
      fileName: result.fileName,
      totalRows: result.totalRows,
      imported: result.successRows,
      failed: result.failedRows,
      /** Rows skipped because their car is archived. */
      archivedRows: result.archivedRows,
      cancelledArchived: result.deletedCancelledRows,
      updatedVehicles: result.updatedVehicles,
      /** Unfinished trips whose dates came back from newer booking mail
       *  or trip-page reads after the export was applied: the CSV is
       *  settled history, not the latest word on a trip still ahead. */
      newerObservationsApplied: result.newerObservationsApplied,
      // Row numbers and reasons only: the rows themselves carry guest
      // names and phones, and the caller already has the file.
      failures: result.failures
        .slice(0, MAX_FAILURES_RETURNED)
        .map((failure) => ({ rowNumber: failure.rowNumber, reason: failure.reason })),
      failuresTruncated: result.failures.length > MAX_FAILURES_RETURNED,
    });
  } catch (error) {
    if (error instanceof TuroSyncError) {
      return withCors(
        { error: error.code, message: error.message, detail: error.details },
        { status: error.status },
      );
    }
    // eslint-disable-next-line no-console
    console.error("[agent] csv import failed", error);
    return withCors({ error: "IMPORT_FAILED" }, { status: 500 });
  }
}

export function OPTIONS() {
  return corsPreflight();
}
