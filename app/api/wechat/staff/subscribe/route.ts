import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import {
  getBearerToken,
  serializeStaffMiniProgramStaff,
  verifyStaffMiniProgramSession,
} from "@/lib/staff-mini-program";

const subscribeSchema = z.object({
  accepted: z.boolean(),
});

export async function POST(request: NextRequest) {
  const token = getBearerToken(request);
  const staff = token ? await verifyStaffMiniProgramSession(token) : null;
  if (!staff) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const parsed = subscribeSchema.parse(await request.json());
  const updatedStaff = await prisma.staffMember.update({
    where: { id: staff.id },
    data: {
      wechatNotificationEnabled: parsed.accepted,
      wechatSubscribedAt: parsed.accepted ? new Date() : null,
    },
  });

  return NextResponse.json({
    staff: serializeStaffMiniProgramStaff(updatedStaff),
  });
}
