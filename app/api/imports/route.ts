import { NextResponse } from "next/server";
import { z } from "zod";

import { requireCurrentAdminContext } from "@/lib/auth";
import { assertImportWithinBillingLimit } from "@/lib/billing";
import { csvReservationIds, normalizeTuroAccount } from "@/lib/csv-mapping";
import { importTuroOrders, normalizeCsvFieldMapping } from "@/lib/orders";
import { reapplyTuroObservations } from "@/lib/turo-email-apply";

const importSchema = z.object({
  fileName: z.string().min(1),
  rows: z.array(z.record(z.string(), z.string())),
  mapping: z.record(z.string(), z.string()),
  createMissingVehicles: z.boolean().optional(),
  selectedVehicleKeys: z.array(z.string()).optional(),
  /** Which Turo host account exported this file. Blank is the main
   *  account. Normalised so "Kevin's vehicle", "Kevin" and "kevin" all
   *  land on the account the email parser derives from the same
   *  prefix -- if these two disagree, a co-hosted car stops matching
   *  its own mail and nothing says why. */
  turoAccount: z.string().trim().max(80).nullish(),
});

export async function POST(request: Request) {
  let context;
  try {
    context = await requireCurrentAdminContext();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const parsed = importSchema.parse(await request.json());
    await assertImportWithinBillingLimit({
      workspaceId: context.workspace.id,
      rows: parsed.rows,
      mapping: parsed.mapping,
      createMissingVehicles: parsed.createMissingVehicles ?? false,
      selectedVehicleKeys: parsed.selectedVehicleKeys ?? [],
    });

    const turoAccount = normalizeTuroAccount(parsed.turoAccount);

    const result = await importTuroOrders({
      workspaceId: context.workspace.id,
      fileName: parsed.fileName,
      rows: parsed.rows,
      mapping: parsed.mapping,
      actor: context.user.name,
      createMissingVehicles: parsed.createMissingVehicles ?? false,
      turoAccount,
      selectedVehicleKeys: parsed.selectedVehicleKeys ?? [],
    });

    // Same step the scheduled sync takes: an unfinished trip gets
    // mail's newer dates now, not on the next Gmail sync.
    const reapplied = await reapplyTuroObservations({
      workspaceId: context.workspace.id,
      reservationIds: csvReservationIds(parsed.rows, normalizeCsvFieldMapping(parsed.mapping)),
    });

    return NextResponse.json({ ...result, newerObservationsApplied: reapplied.updated });
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as Error & { code?: string }).code === "BILLING_LIMIT_EXCEEDED"
    ) {
      return NextResponse.json(
        {
          error: error.message,
          details: (error as Error & { details?: unknown }).details,
        },
        { status: 402 },
      );
    }

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Import failed",
      },
      { status: 400 },
    );
  }
}
