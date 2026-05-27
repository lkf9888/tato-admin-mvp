import { notFound } from "next/navigation";

import { StaffShareClient } from "@/components/staff-share-client";
import { getI18n } from "@/lib/i18n-server";
import { prisma } from "@/lib/prisma";
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

  const tasks = await prisma.staffTask.findMany({
    where: {
      workspaceId: staff.workspaceId,
      staffId: staff.id,
    },
    include: staffShareTaskInclude,
    orderBy: [{ sortOrder: "asc" }, { dueDatetime: "asc" }, { createdAt: "asc" }],
  });

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
    />
  );
}
