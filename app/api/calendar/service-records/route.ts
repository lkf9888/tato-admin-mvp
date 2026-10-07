import { NextResponse } from "next/server";

import { requireAccessContext } from "@/lib/auth";
import { logActivity } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import {
  dayRange,
  listServiceRecords,
  serviceRecordPayload,
  serviceRecordSchema,
  toDayKey,
  vehicleUsable,
} from "@/lib/service-records";

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Repairs, services and mileage readings overlapping `from`..`to`, for the calendar. */
export async function GET(request: Request) {
  const { workspace, vehicleIds } = await requireAccessContext();
  const params = new URL(request.url).searchParams;
  const from = params.get("from");
  const to = params.get("to");
  if (!from || !to || !DAY_PATTERN.test(from) || !DAY_PATTERN.test(to)) {
    return NextResponse.json({ error: "INVALID_RANGE" }, { status: 400 });
  }
  return NextResponse.json({ records: await listServiceRecords(workspace.id, from, to, vehicleIds) });
}

export async function POST(request: Request) {
  const { workspace, user, vehicleIds } = await requireAccessContext();
  const parsed = serviceRecordSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });
  if (!(await vehicleUsable(workspace.id, parsed.data.vehicleId, vehicleIds))) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  const { startDate, endDate } = dayRange(parsed.data);
  const record = await prisma.vehicleServiceRecord.create({
    data: {
      workspaceId: workspace.id,
      vehicleId: parsed.data.vehicleId,
      startDate,
      endDate,
      kind: parsed.data.kind,
      description: parsed.data.description,
      mileage: parsed.data.mileage,
      cost: parsed.data.cost,
      createdBy: user.name,
    },
  });
  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: "service_record_created",
    entityType: "VehicleServiceRecord",
    entityId: record.id,
    metadata: { vehicleId: record.vehicleId, kind: record.kind, startDate: toDayKey(startDate), mileage: record.mileage },
  });
  return NextResponse.json({ record: serviceRecordPayload(record) });
}
