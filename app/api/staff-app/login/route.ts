import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  createStaffAppSession,
  ensureStaffShareToken,
  findStaffByAppCode,
  listStaffMiniProgramTasks,
  serializeStaffMiniProgramStaff,
} from "@/lib/staff-app";

const loginSchema = z.object({
  staffCode: z.string().trim().min(1),
});

function getBaseUrl(request: NextRequest) {
  return (process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/$/, "");
}

export async function POST(request: NextRequest) {
  const parsed = loginSchema.parse(await request.json());
  const staff = await findStaffByAppCode(parsed.staffCode);
  if (!staff) {
    return NextResponse.json({ error: "STAFF_CODE_NOT_FOUND" }, { status: 404 });
  }

  const shareToken = await ensureStaffShareToken(staff);
  if (!shareToken) {
    return NextResponse.json({ error: "STAFF_SHARE_TOKEN_NOT_AVAILABLE" }, { status: 500 });
  }

  const sessionStaff = { ...staff, shareToken };
  const token = createStaffAppSession(staff.id);
  const tasks = await listStaffMiniProgramTasks({
    staff: sessionStaff,
    baseUrl: getBaseUrl(request),
  });

  return NextResponse.json({
    token,
    staff: serializeStaffMiniProgramStaff(sessionStaff),
    tasks,
  });
}
