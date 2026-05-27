import { NextRequest, NextResponse } from "next/server";

import {
  getBearerToken,
  getWeChatTaskTemplateId,
  listStaffMiniProgramTasks,
  serializeStaffMiniProgramStaff,
  verifyStaffMiniProgramSession,
} from "@/lib/staff-mini-program";

function getBaseUrl(request: NextRequest) {
  return (process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/$/, "");
}

export async function GET(request: NextRequest) {
  const token = getBearerToken(request);
  const staff = token ? await verifyStaffMiniProgramSession(token) : null;
  if (!staff) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const tasks = await listStaffMiniProgramTasks({
    staff,
    baseUrl: getBaseUrl(request),
  });

  return NextResponse.json({
    staff: serializeStaffMiniProgramStaff(staff),
    tasks,
    wechat: {
      taskTemplateId: getWeChatTaskTemplateId() || null,
      notificationEnabled: staff.wechatNotificationEnabled,
    },
  });
}
