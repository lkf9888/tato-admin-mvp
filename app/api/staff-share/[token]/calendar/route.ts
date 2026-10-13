import { NextResponse } from "next/server";

import { buildIcalendar } from "@/lib/ical";
import { prisma } from "@/lib/prisma";
import { staffCalendarTaskInclude, staffTaskEvents } from "@/lib/staff-calendar";
import { findSharedStaff } from "@/lib/staff-share";

export const runtime = "nodejs";

type Params = Promise<{ token: string }>;

const DAY_IN_MS = 24 * 60 * 60 * 1000;
/** Recent past for context, and as far ahead as anything is planned. */
const PAST_DAYS = 30;
const FUTURE_DAYS = 180;

/**
 * One staff member's tasks as a subscribable calendar.
 *
 * Unauthenticated, like the task page it belongs to: a calendar app
 * cannot sign in, so the person's share token is the whole
 * authorisation -- the same token as their task page, so revoking one
 * revokes both. Archived staff get nothing.
 */
export async function GET(request: Request, { params }: { params: Params }) {
  const { token } = await params;
  const clean = token.replace(/\.ics$/i, "");
  const staff = clean.length >= 20 ? await findSharedStaff(clean) : null;
  if (!staff?.workspaceId) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const now = Date.now();
  const from = new Date(now - PAST_DAYS * DAY_IN_MS);
  const to = new Date(now + FUTURE_DAYS * DAY_IN_MS);
  const tasks = await prisma.staffTask.findMany({
    where: {
      workspaceId: staff.workspaceId,
      staffId: staff.id,
      parentTaskId: null,
      OR: [
        { dueDatetime: { gte: from, lte: to } },
        { order: { pickupDatetime: { lte: to }, returnDatetime: { gte: from } } },
      ],
    },
    include: staffCalendarTaskInclude,
    orderBy: { dueDatetime: "asc" },
  });

  const origin = (process.env.NEXT_PUBLIC_APP_URL?.trim() || new URL(request.url).origin).replace(/\/$/, "");
  const body = buildIcalendar({
    name: `${staff.name} · TATO`,
    events: staffTaskEvents(tasks, `${origin}/staff-share/${clean}`),
  });

  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="tato-tasks.ics"',
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
