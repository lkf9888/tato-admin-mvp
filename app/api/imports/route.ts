import { NextResponse } from "next/server";
import { z } from "zod";

import { isAdminAuthenticated } from "@/lib/auth";
import { assertImportWithinBillingLimit } from "@/lib/billing";
import { importTuroOrders } from "@/lib/orders";

const importSchema = z.object({
  fileName: z.string().min(1),
  rows: z.array(z.record(z.string(), z.string())),
  mapping: z.record(z.string(), z.string()),
  createMissingVehicles: z.boolean().optional(),
  selectedVehicleKeys: z.array(z.string()).optional(),
});

export async function POST(request: Request) {
  const authenticated = await isAdminAuthenticated();
  if (!authenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const parsed = importSchema.parse(await request.json());
    await assertImportWithinBillingLimit({
      rows: parsed.rows,
      mapping: parsed.mapping,
      createMissingVehicles: parsed.createMissingVehicles ?? false,
      selectedVehicleKeys: parsed.selectedVehicleKeys ?? [],
    });

    const result = await importTuroOrders({
      fileName: parsed.fileName,
      rows: parsed.rows,
      mapping: parsed.mapping,
      actor: "Admin",
      createMissingVehicles: parsed.createMissingVehicles ?? false,
      selectedVehicleKeys: parsed.selectedVehicleKeys ?? [],
    });

    return NextResponse.json(result);
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
