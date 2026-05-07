import { NextResponse } from "next/server";
import { z } from "zod";

import { isAdminAuthenticated } from "@/lib/auth";
import { importTuroOrders } from "@/lib/orders";

const importSchema = z.object({
  fileName: z.string().min(1),
  rows: z.array(z.record(z.string(), z.string())),
  mapping: z.record(z.string(), z.string()),
  createMissingVehicles: z.boolean().optional(),
});

export async function POST(request: Request) {
  const authenticated = await isAdminAuthenticated();
  if (!authenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const parsed = importSchema.parse(await request.json());
    const result = await importTuroOrders({
      fileName: parsed.fileName,
      rows: parsed.rows,
      mapping: parsed.mapping,
      actor: "Admin",
      createMissingVehicles: parsed.createMissingVehicles ?? false,
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Import failed",
      },
      { status: 400 },
    );
  }
}
