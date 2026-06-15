import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { findSharedStaff, serializeStaffShareTask, staffShareTaskInclude } from "@/lib/staff-share";

type Params = Promise<{ token: string }>;

export async function GET(_request: Request, { params }: { params: Params }) {
  const { token } = await params;
  const staff = await findSharedStaff(token);
  if (!staff) {
    return NextResponse.json({ error: "STAFF_SHARE_NOT_FOUND" }, { status: 404 });
  }

  const tasks = await prisma.staffTask.findMany({
    where: {
      workspaceId: staff.workspaceId,
      staffId: staff.id,
    },
    include: staffShareTaskInclude,
    orderBy: [{ sortOrder: "asc" }, { dueDatetime: "asc" }, { createdAt: "asc" }],
  });

  return NextResponse.json({
    source: "tato",
    token,
    staff: {
      id: staff.id,
      name: staff.name,
      role: staff.role,
      phone: staff.phone,
      email: staff.email,
      color: staff.color,
      pinnedMessage: staff.pinnedMessage,
    },
    tasks: tasks.map((task) => serializeStaffShareTask(token, task)),
  });
}
