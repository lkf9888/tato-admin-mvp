import type { Prisma } from "@prisma/client";

import { zonedDateTimeToUtc } from "@/lib/booking-time";
import type { IcalEvent } from "@/lib/ical";

/**
 * A staff member's tasks as calendar events, for the feed they add to
 * Google Calendar (or Apple's, or Outlook's) from their own task page.
 *
 * Subscribed calendars refresh on the calendar app's schedule, not
 * ours -- Google's takes hours -- so this is the shape of the week, not
 * a notification channel; the SMS and mini-program messages stay that.
 */

export const staffCalendarTaskInclude = {
  vehicle: { select: { plateNumber: true, nickname: true } },
  order: {
    select: { renterName: true, pickupDatetime: true, returnDatetime: true, pickupLocation: true, returnLocation: true },
  },
} satisfies Prisma.StaffTaskInclude;

type Task = Prisma.StaffTaskGetPayload<{ include: typeof staffCalendarTaskInclude }>;

const HOUR = 60 * 60 * 1000;

/** The pickup code stays on the task page: a calendar is copied to
 *  every device the person owns and kept for years. */
const PICKUP_CODE_LINE = /^\s*(取车密码|pickup (password|code))\s*[:：]/i;

function stripPickupCode(text: string | null) {
  return (text ?? "")
    .split("\n")
    .filter((line) => !PICKUP_CODE_LINE.test(line))
    .join("\n")
    .trim();
}

/** When a task happens: an order's handover at its own time; anything
 *  else at the time its time window names on its due date, or all day
 *  when it names none. Null for a task with no date at all. */
function when(task: Task): Pick<IcalEvent, "start" | "end" | "allDay"> | null {
  if (task.category === "order_pickup" && task.order) {
    return { start: task.order.pickupDatetime, end: new Date(task.order.pickupDatetime.getTime() + HOUR) };
  }
  if (task.category === "order_return" && task.order) {
    return { start: task.order.returnDatetime, end: new Date(task.order.returnDatetime.getTime() + HOUR) };
  }
  if (!task.dueDatetime) return null;
  // Date-only values are stored at noon UTC, so the UTC date is the day
  // that was picked.
  const day = task.dueDatetime.toISOString().slice(0, 10);
  const time = task.timeWindow?.match(/\b(\d{1,2}):(\d{2})\b/);
  if (time) {
    const start = zonedDateTimeToUtc(day, `${time[1].padStart(2, "0")}:${time[2]}`);
    if (start) return { start, end: new Date(start.getTime() + HOUR) };
  }
  return { start: task.dueDatetime, end: task.dueDatetime, allDay: true };
}

export function staffTaskEvents(tasks: Task[], pageUrl: string): IcalEvent[] {
  return tasks.flatMap((task) => {
    const at = when(task);
    if (!at) return [];
    const location =
      task.category === "order_return"
        ? task.order?.returnLocation || task.order?.pickupLocation
        : task.category === "order_pickup"
          ? task.order?.pickupLocation
          : null;
    const details = stripPickupCode(task.details);
    return [
      {
        uid: `staff-task-${task.id}@tatocar.co`,
        ...at,
        // Ticked off, still on the calendar: a day's record of what was
        // done is worth keeping, and the tick says it is not still to do.
        summary: `${task.status === "done" ? "✓ " : ""}${task.title}`,
        description: [details, pageUrl].filter(Boolean).join("\n\n"),
        location: location ?? undefined,
        url: pageUrl,
        cancelled: task.status === "cancelled",
        updatedAt: task.updatedAt,
      },
    ];
  });
}
