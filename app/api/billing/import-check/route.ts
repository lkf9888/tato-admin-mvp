import { NextResponse } from "next/server";
import { z } from "zod";

import { requireCurrentAdminContext } from "@/lib/auth";
import { getImportBillingProjection } from "@/lib/billing";

const importCheckSchema = z.object({
  rows: z.array(z.record(z.string(), z.string())),
  mapping: z.record(z.string(), z.string()),
  createMissingVehicles: z.boolean().optional(),
  selectedVehicleKeys: z.array(z.string()).optional(),
});

export async function POST(request: Request) {
  let context;
  try {
    context = await requireCurrentAdminContext();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const parsed = importCheckSchema.parse(await request.json());
    const projection = await getImportBillingProjection({
      workspaceId: context.workspace.id,
      rows: parsed.rows,
      mapping: parsed.mapping,
      createMissingVehicles: parsed.createMissingVehicles ?? false,
      selectedVehicleKeys: parsed.selectedVehicleKeys ?? [],
    });

    return NextResponse.json(projection);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Billing check failed",
      },
      { status: 400 },
    );
  }
}
