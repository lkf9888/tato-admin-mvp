import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { bridgeStaffQuotaGrant, bridgeStaffSubscription } from "@/lib/notify-client";
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

  // `.parse()` throws, and so does `request.json()` on a body that

  // is not JSON. Uncaught, both leave the handler as a 500 -- which

  // is a crash report where a validation error belongs, and on the

  // staff routes it is reached from a phone on a bad connection.

  const parsedResult = subscribeSchema.safeParse(await request.json().catch(() => null));

  if (!parsedResult.success) {

    return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });

  }

  const parsed = parsedResult.data;
  const updatedStaff = await prisma.staffMember.update({
    where: { id: staff.id },
    data: {
      wechatNotificationEnabled: parsed.accepted,
      wechatSubscribedAt: parsed.accepted ? new Date() : null,
    },
  });

  // The flag above is what the staff schedule reads; the hub is what
  // actually sends. An accepted authorisation is worth exactly one
  // message, so it is counted rather than treated as a switch -- this
  // mini program predates the hub and still reports a tap as a boolean.
  if (parsed.accepted && staff.wechatOpenId) {
    await bridgeStaffSubscription({
      staffId: staff.id,
      staffName: updatedStaff.name,
      openId: staff.wechatOpenId,
    });
    await bridgeStaffQuotaGrant(staff.wechatOpenId);
  }

  return NextResponse.json({
    staff: serializeStaffMiniProgramStaff(updatedStaff),
  });
}
