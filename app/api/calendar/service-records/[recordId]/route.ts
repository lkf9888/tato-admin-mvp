import { NextResponse } from "next/server";

import { requireAccessContext } from "@/lib/auth";
import { logActivity } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import { dayRange, serviceRecordPayload, serviceRecordSchema, vehicleUsable } from "@/lib/service-records";

type Params = Promise<{ recordId: string }>;

/** The record, if it is on this workspace and, for a member limited to some cars, one of theirs. */
async function findRecord(recordId: string, workspaceId: string, vehicleIds: string[] | null) {
  const record = await prisma.vehicleServiceRecord.findFirst({
    where: { id: recordId, workspaceId, isArchived: false },
  });
  if (!record || (vehicleIds && !vehicleIds.includes(record.vehicleId))) return null;
  return record;
}

export async function PATCH(request: Request, { params }: { params: Params }) {
  const { recordId } = await params;
  const { workspace, user, vehicleIds } = await requireAccessContext();
  const existing = await findRecord(recordId, workspace.id, vehicleIds);
  if (!existing) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const parsed = serviceRecordSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });
  if (!(await vehicleUsable(workspace.id, parsed.data.vehicleId, vehicleIds))) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  const { startDate, endDate } = dayRange(parsed.data);
  const record = await prisma.vehicleServiceRecord.update({
    where: { id: existing.id },
    data: {
      vehicleId: parsed.data.vehicleId,
      startDate,
      endDate,
      kind: parsed.data.kind,
      description: parsed.data.description,
      mileage: parsed.data.mileage,
      cost: parsed.data.cost,
    },
  });
  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: "service_record_updated",
    entityType: "VehicleServiceRecord",
    entityId: record.id,
    metadata: { vehicleId: record.vehicleId, kind: record.kind },
  });
  return NextResponse.json({ record: serviceRecordPayload(record) });
}

/** Archived, not deleted, like calendar notes: a mis-click should not lose a service history. */
export async function DELETE(_request: Request, { params }: { params: Params }) {
  const { recordId } = await params;
  const { workspace, user, vehicleIds } = await requireAccessContext();
  const existing = await findRecord(recordId, workspace.id, vehicleIds);
  if (!existing) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  await prisma.vehicleServiceRecord.update({ where: { id: existing.id }, data: { isArchived: true } });
  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: "service_record_deleted",
    entityType: "VehicleServiceRecord",
    entityId: existing.id,
    metadata: { vehicleId: existing.vehicleId },
  });
  return NextResponse.json({ ok: true });
}
