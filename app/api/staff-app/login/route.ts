import { checkRateLimit, getClientIp, recordFailedAttempt } from "@/lib/rate-limit";
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
  // Staff codes are short and the endpoint is public, so without a
  // bound this is a keyspace anyone can walk. Twenty attempts in ten
  // minutes is far more than a person mistyping their own code and far
  // less than a script needs to be useful. Keyed on IP because there is
  // no identity to key on until the code is right.
  const ip = await getClientIp();
  const decision = await checkRateLimit({
    scope: "staff_app_login",
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
  const staff = await findStaffByAppCode(parsed.staffCode);
  if (!staff) {
    await recordFailedAttempt({
      scope: "staff_app_login",
      identifier: ip,
      windowMs: 10 * 60 * 1000,
    });
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
