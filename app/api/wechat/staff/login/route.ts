import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import {
  createStaffMiniProgramSession,
  ensureStaffMiniProgramCode,
  ensureStaffShareToken,
  exchangeWeChatLoginCode,
  getWeChatTaskTemplateId,
  isWeChatMiniProgramConfigured,
  listStaffMiniProgramTasks,
  normalizeStaffMiniProgramCode,
  serializeStaffMiniProgramStaff,
} from "@/lib/staff-mini-program";

const loginSchema = z.object({
  wxCode: z.string().trim().min(1),
  staffCode: z.string().trim().optional().or(z.literal("")),
});

function getBaseUrl(request: NextRequest) {
  return (process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/$/, "");
}

export async function POST(request: NextRequest) {
  if (!isWeChatMiniProgramConfigured()) {
    return NextResponse.json({ error: "WECHAT_MINIPROGRAM_NOT_CONFIGURED" }, { status: 503 });
  }

  const parsed = loginSchema.parse(await request.json());
  const staffCode = parsed.staffCode ? normalizeStaffMiniProgramCode(parsed.staffCode) : "";
  const wechatSession = await exchangeWeChatLoginCode(parsed.wxCode);

  const existingBoundStaff = await prisma.staffMember.findFirst({
    where: { wechatOpenId: wechatSession.openid, isActive: true },
  });

  let staff = existingBoundStaff;
  if (staffCode) {
    const codeStaff = await prisma.staffMember.findUnique({
      where: { miniProgramCode: staffCode },
    });
    if (!codeStaff || !codeStaff.isActive) {
      return NextResponse.json({ error: "STAFF_CODE_NOT_FOUND" }, { status: 404 });
    }
    if (codeStaff.wechatOpenId && codeStaff.wechatOpenId !== wechatSession.openid) {
      return NextResponse.json({ error: "STAFF_CODE_ALREADY_BOUND" }, { status: 409 });
    }
    if (existingBoundStaff && existingBoundStaff.id !== codeStaff.id) {
      return NextResponse.json({ error: "WECHAT_ALREADY_BOUND_TO_OTHER_STAFF" }, { status: 409 });
    }
    staff = codeStaff;
  }

  if (!staff) {
    return NextResponse.json({ error: "STAFF_CODE_REQUIRED" }, { status: 401 });
  }

  const miniProgramCode = await ensureStaffMiniProgramCode(staff);
  const shareToken = await ensureStaffShareToken(staff);
  if (!shareToken) {
    return NextResponse.json({ error: "STAFF_SHARE_TOKEN_NOT_AVAILABLE" }, { status: 500 });
  }
  const updatedStaff = await prisma.staffMember.update({
    where: { id: staff.id },
    data: {
      miniProgramCode,
      shareToken,
      wechatOpenId: wechatSession.openid,
      wechatBoundAt: staff.wechatOpenId === wechatSession.openid ? staff.wechatBoundAt : new Date(),
    },
  });

  const token = createStaffMiniProgramSession(updatedStaff.id, wechatSession.openid);
  const tasks = await listStaffMiniProgramTasks({
    staff: { id: updatedStaff.id, workspaceId: updatedStaff.workspaceId, shareToken },
    baseUrl: getBaseUrl(request),
  });

  return NextResponse.json({
    token,
    staff: serializeStaffMiniProgramStaff(updatedStaff),
    tasks,
    wechat: {
      taskTemplateId: getWeChatTaskTemplateId() || null,
      notificationEnabled: updatedStaff.wechatNotificationEnabled,
    },
  });
}
