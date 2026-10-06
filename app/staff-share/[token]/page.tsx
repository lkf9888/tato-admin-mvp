import { notFound } from "next/navigation";

import { StaffShareClient } from "@/components/staff-share-client";
import { getI18n } from "@/lib/i18n-server";
import { prisma } from "@/lib/prisma";
import { utcToZonedDate, utcToZonedTime } from "@/lib/booking-time";
import { getStaffPayoutDetail } from "@/lib/staff-payout";
import { findSameDayPickups } from "@/lib/staff-same-day";
import { findSharedStaff, serializeStaffShareTask, staffShareTaskInclude } from "@/lib/staff-share";

export const metadata = {
  title: "TATO Staff Tasks",
  robots: {
    index: false,
    follow: false,
  },
};

export default async function StaffSharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const [{ token }, { locale }] = await Promise.all([params, getI18n()]);
  const staff = await findSharedStaff(token);
  if (!staff) notFound();

  const [tasks, income] = await Promise.all([
    prisma.staffTask.findMany({
      where: {
        workspaceId: staff.workspaceId,
        staffId: staff.id,
      },
      include: staffShareTaskInclude,
      orderBy: [{ sortOrder: "asc" }, { dueDatetime: "asc" }, { createdAt: "asc" }],
    }),
    // The same numbers the operator's pay page shows, minus what is
    // the operator's alone (lib/staff-payout.ts).
    staff.workspaceId ? getStaffPayoutDetail(staff.workspaceId, staff.id, { forStaff: true }) : null,
  ]);

  // Other trips' pick-ups on the cars these tasks are on, around the
  // tasks' days -- enough to say which jobs sit between a return and a
  // pick-up on the same day.
  const openTasks = tasks.filter(
    (task) => task.vehicleId && task.dueDatetime && task.status !== "done" && task.status !== "cancelled",
  );
  const dueTimes = openTasks.map((task) => task.dueDatetime!.getTime());
  const nearbyPickups =
    staff.workspaceId && openTasks.length > 0
      ? await prisma.order.findMany({
          where: {
            workspaceId: staff.workspaceId,
            vehicleId: { in: [...new Set(openTasks.map((task) => task.vehicleId!))] },
            isArchived: false,
            status: { not: "cancelled" },
            pickupDatetime: {
              gte: new Date(Math.min(...dueTimes) - 2 * 86_400_000),
              lte: new Date(Math.max(...dueTimes) + 2 * 86_400_000),
            },
          },
          select: { id: true, vehicleId: true, pickupDatetime: true, renterName: true },
        })
      : [];
  const sameDay = findSameDayPickups(
    openTasks.map((task) => ({ ...task, dueDatetime: task.dueDatetime!.toISOString() })),
    nearbyPickups.map((order) => ({ ...order, pickupDatetime: order.pickupDatetime.toISOString() })),
    (iso) => utcToZonedDate(new Date(iso)),
  );
  const sameDayPickups = Object.fromEntries(
    [...sameDay].map(([taskId, pickup]) => [
      taskId,
      { time: utcToZonedTime(new Date(pickup.pickupDatetime)), renterName: pickup.renterName },
    ]),
  );

  return (
    <StaffShareClient
      locale={locale}
      token={token}
      staff={{
        name: staff.name,
        role: staff.role,
        color: staff.color,
        miniProgramCode: staff.miniProgramCode,
        pinnedMessage: staff.pinnedMessage,
      }}
      initialTasks={tasks.map((task) => serializeStaffShareTask(token, task))}
      income={income ?? undefined}
      sameDayPickups={sameDayPickups}
    />
  );
}
