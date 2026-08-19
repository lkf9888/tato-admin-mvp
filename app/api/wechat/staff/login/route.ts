import { checkRateLimit, getClientIp, recordFailedAttempt } from "@/lib/rate-limit";
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

  // Staff codes are short and the endpoint is public, so without a
  // bound this is a keyspace anyone can walk. Twenty attempts in ten
  // minutes is far more than a person mistyping their own code and far
  // less than a script needs to be useful. Keyed on IP because there is
  // no identity to key on until the code is right.
  const ip = await getClientIp();
  const decision = await checkRateLimit({
    scope: "wechat_staff_login",
    identifier: ip,
    maxAttempts: 20,
    windowMs: 10 * 60 * 1000,
  });
  if (!decision.allowed) {
    return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
  }

  // `.parse()` throws, and so does `request.json()` on a body that

  // is not JSON. Uncaught, both leave the handler as a 500 -- which

  // is a crash report where a validation error belongs, and on the

  // staff routes it is reached from a phone on a bad connection.

  const parsedResult = loginSchema.safeParse(await request.json().catch(() => null));

  if (!parsedResult.success) {

    return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });

  }

  const parsed = parsedResult.data;
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
      await recordFailedAttempt({
      scope: "wechat_staff_login",
      identifier: ip,
      windowMs: 10 * 60 * 1000,
    });
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
