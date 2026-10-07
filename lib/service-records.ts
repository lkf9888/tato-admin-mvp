import "server-only";

import { z } from "zod";

import { prisma } from "@/lib/prisma";

/**
 * A car's repairs, services and odometer readings, as the calendar draws
 * them. Whole days, stored as midnight UTC and passed as `YYYY-MM-DD`,
 * for the same reason calendar notes are (app/api/calendar/notes).
 */

export const SERVICE_KINDS = ["repair", "maintenance", "mileage", "other"] as const;
export type ServiceKind = (typeof SERVICE_KINDS)[number];

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const serviceRecordSchema = z.object({
  vehicleId: z.string().min(1),
  startDate: z.string().regex(DAY_PATTERN),
  endDate: z.string().regex(DAY_PATTERN),
  kind: z.enum(SERVICE_KINDS),
  description: z.string().trim().max(1000).default(""),
  mileage: z.number().int().min(0).max(5_000_000).nullable().default(null),
  cost: z.number().min(0).max(1_000_000).nullable().default(null),
});

export type ServiceRecordInput = z.infer<typeof serviceRecordSchema>;

export function toDay(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

export function toDayKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

/** Start and end as days, in order whichever way they were given. */
export function dayRange(input: { startDate: string; endDate: string }) {
  const [startDate, endDate] = [toDay(input.startDate), toDay(input.endDate)].sort(
    (left, right) => left.getTime() - right.getTime(),
  );
  return { startDate, endDate };
}

type Row = Awaited<ReturnType<typeof prisma.vehicleServiceRecord.findFirstOrThrow>>;

export function serviceRecordPayload(record: Row) {
  return {
    id: record.id,
    vehicleId: record.vehicleId,
    startDate: toDayKey(record.startDate),
    endDate: toDayKey(record.endDate),
    kind: record.kind as ServiceKind,
    description: record.description,
    mileage: record.mileage,
    cost: record.cost,
  };
}

export type ServiceRecordPayload = ReturnType<typeof serviceRecordPayload>;

/** Records overlapping a range of days, on this workspace and, when limited, these cars. */
export async function listServiceRecords(workspaceId: string, from: string, to: string, vehicleIds: string[] | null) {
  const rows = await prisma.vehicleServiceRecord.findMany({
    where: {
      workspaceId,
      isArchived: false,
      startDate: { lte: toDay(to) },
      endDate: { gte: toDay(from) },
      ...(vehicleIds ? { vehicleId: { in: vehicleIds } } : {}),
    },
    orderBy: { startDate: "asc" },
  });
  return rows.map(serviceRecordPayload);
}

/** Whether a car is this workspace's and, when limited, one of these. */
export async function vehicleUsable(workspaceId: string, vehicleId: string, vehicleIds: string[] | null) {
  if (vehicleIds && !vehicleIds.includes(vehicleId)) return false;
  return Boolean(await prisma.vehicle.findFirst({ where: { id: vehicleId, workspaceId }, select: { id: true } }));
}
