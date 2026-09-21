import { NextResponse } from "next/server";
import { z } from "zod";

import { requireCurrentAdminContext } from "@/lib/auth";
import { logActivity } from "@/lib/orders";
import { prisma } from "@/lib/prisma";

/**
 * Notes written on the calendar itself.
 *
 * Whole days, stored and returned as `YYYY-MM-DD`. A note is read
 * against the day columns, so giving it a timestamp would make the
 * band's edges move with the reader's timezone -- the note that says
 * "winter tyres on the 3rd" would start on the 2nd for somebody in
 * another zone.
 */

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const noteSchema = z.object({
  vehicleId: z.string().min(1),
  startDate: z.string().regex(DAY_PATTERN),
  endDate: z.string().regex(DAY_PATTERN),
  text: z.string().trim().min(1).max(500),
});

/** Midnight UTC for a `YYYY-MM-DD`, which is how whole days are kept. */
function toDay(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function toDayKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  const { workspace } = await requireCurrentAdminContext();
  const params = new URL(request.url).searchParams;
  const from = params.get("from");
  const to = params.get("to");

  if (!from || !to || !DAY_PATTERN.test(from) || !DAY_PATTERN.test(to)) {
    return NextResponse.json({ error: "INVALID_RANGE" }, { status: 400 });
  }

  const notes = await prisma.calendarNote.findMany({
    where: {
      workspaceId: workspace.id,
      isArchived: false,
      // Overlap, so a note that starts before the window and ends
      // inside it still draws its visible part.
      startDate: { lte: toDay(to) },
      endDate: { gte: toDay(from) },
    },
    orderBy: { startDate: "asc" },
  });

  return NextResponse.json({
    notes: notes.map((note) => ({
      id: note.id,
      vehicleId: note.vehicleId,
      startDate: toDayKey(note.startDate),
      endDate: toDayKey(note.endDate),
      text: note.text,
    })),
  });
}

export async function POST(request: Request) {
  const { workspace, user } = await requireCurrentAdminContext();

  const parsed = noteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });
  }

  const { vehicleId, text } = parsed.data;
  // Written the way they were selected or the way they were typed --
  // either order is a run of days, and a note from the 9th to the 3rd
  // is the same note as one from the 3rd to the 9th.
  const [startDate, endDate] = [toDay(parsed.data.startDate), toDay(parsed.data.endDate)].sort(
    (left, right) => left.getTime() - right.getTime(),
  );

  const vehicle = await prisma.vehicle.findFirst({
    where: { id: vehicleId, workspaceId: workspace.id },
    select: { id: true },
  });
  if (!vehicle) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const note = await prisma.calendarNote.create({
    data: {
      workspaceId: workspace.id,
      vehicleId,
      startDate,
      endDate,
      text,
      createdBy: user.name,
    },
  });

  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: "calendar_note_created",
    entityType: "CalendarNote",
    entityId: note.id,
    metadata: { vehicleId, startDate: toDayKey(startDate), endDate: toDayKey(endDate) },
  });

  return NextResponse.json({
    note: {
      id: note.id,
      vehicleId: note.vehicleId,
      startDate: toDayKey(note.startDate),
      endDate: toDayKey(note.endDate),
      text: note.text,
    },
  });
}
