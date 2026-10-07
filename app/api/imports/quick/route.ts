import { NextResponse } from "next/server";

import { requireCurrentAdminContext } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { importTuroCsvWithLastSettings, TuroSyncError } from "@/lib/turo-sync";

export const runtime = "nodejs";

/** Bigger than any real export: the user's 2569-row file is about 1 MB. */
const MAX_FILE_BYTES = 10 * 1024 * 1024;

/**
 * The accounts to pick from: every one the fleet's cars are filed
 * under, as the imports page offers, and the one last imported.
 */
export async function GET() {
  const { workspace } = await requireCurrentAdminContext();
  const [vehicles, last] = await Promise.all([
    prisma.vehicle.findMany({
      where: { workspaceId: workspace.id, turoAccount: { not: null } },
      distinct: ["turoAccount"],
      select: { turoAccount: true },
      orderBy: { turoAccount: "asc" },
    }),
    prisma.importBatch.findFirst({
      where: { workspaceId: workspace.id },
      orderBy: { importedAt: "desc" },
      select: { turoAccount: true },
    }),
  ]);
  return NextResponse.json({
    accounts: vehicles.map((row) => row.turoAccount).filter((account): account is string => Boolean(account)),
    // "" is the main account; null means nothing was imported yet.
    lastAccount: last ? (last.turoAccount ?? "") : null,
  });
}

/**
 * The dashboard's quick CSV import: a file and the Turo account it came
 * from (see `importTuroCsvWithLastSettings`). Multipart, so
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
      // Sent as "" for the main account; absent only from an older page.
      turoAccount: form?.has("turoAccount") ? String(form.get("turoAccount") ?? "") : undefined,
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
