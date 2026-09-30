import { NextResponse } from "next/server";

import { requireCurrentAdminContext } from "@/lib/auth";
import { importTuroCsvWithLastSettings, TuroSyncError } from "@/lib/turo-sync";

export const runtime = "nodejs";

/** Bigger than any real export: the user's 2569-row file is about 1 MB. */
const MAX_FILE_BYTES = 10 * 1024 * 1024;

/**
 * The dashboard's one-click CSV import: a file, imported with the last
 * import's settings (see `importTuroCsvWithLastSettings`). Multipart, so
 * the browser sends the file as it is instead of parsing it first.
 */
export async function POST(request: Request) {
  const { workspace, user } = await requireCurrentAdminContext();

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "NO_FILE" }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: "FILE_TOO_LARGE" }, { status: 413 });
  }

  try {
    const result = await importTuroCsvWithLastSettings({
      workspaceId: workspace.id,
      actor: user.name,
      fileName: file.name || "quick-import.csv",
      content: await file.text(),
      billingBypassActive: Boolean(user.isBillingExempt),
    });

    // The cars behind "Vehicle not found" rows, once each: that list is
    // the one thing a person has to act on after a quick import.
    const missingVehicles = [
      ...new Set(
        result.failures
          .map((failure) => /^Vehicle not found for "(.*)"$/.exec(failure.reason)?.[1])
          .filter((label): label is string => Boolean(label)),
      ),
    ];

    return NextResponse.json({
      ok: true,
      batchId: result.batchId,
      fileName: result.fileName,
      totalRows: result.totalRows,
      imported: result.successRows,
      failed: result.failedRows,
      cancelled: result.deletedCancelledRows,
      archivedRows: result.archivedRows,
      newerObservationsApplied: result.newerObservationsApplied,
      missingVehicles,
      otherFailures: result.failures.filter((failure) => !failure.reason.startsWith("Vehicle not found"))
        .length,
      settings: result.settings,
    });
  } catch (error) {
    if (error instanceof TuroSyncError) {
      return NextResponse.json(
        { error: error.code, message: error.message },
        { status: error.status },
      );
    }
    return NextResponse.json({ error: "IMPORT_FAILED" }, { status: 500 });
  }
}
