import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { getQuota, grantQuota } from "@/lib/notify-hub/quota";
import { authenticateSubscriber } from "@/lib/notify-hub/session";

export const runtime = "nodejs";

/**
 * Record what `wx.requestSubscribeMessage` just granted.
 *
 * This endpoint is the fix for the bug the first integration shipped
 * with. WeChat's one-off subscription buys exactly one message per
 * accepted template, and the old code treated a single tap as a
 * permanent switch: the first task notification arrived, every one
 * after it was discarded with 43101, and the admin screen went on
 * showing a green "WeChat reminders on" for weeks.
 *
 * So the client reports every grant and the server counts them. The
 * client's other half of the deal is to ask often -- on launch, after
 * finishing a task -- because a person who ticks "keep this choice"
 * tops up silently from then on, and the count is what tells the
 * client whether asking again is worth a dialog.
 */

const subscribeSchema = z.object({
  /** Logical template key -> what the WeChat dialog returned. */
  granted: z.record(z.enum(["accept", "reject", "ban", "filter"])),
});

export async function POST(request: NextRequest) {
  const subscriber = authenticateSubscriber(request);
  if (!subscriber) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const parsed = subscribeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });
  }

  const templates = await prisma.notifyTemplate.findMany({
    where: { miniProgramId: subscriber.miniProgramId, isActive: true },
    select: { key: true },
  });
  const known = new Set(templates.map((template) => template.key));

  // Only accepted, known keys add a slot. A client that reports a
  // template we have since retired, or invents one, must not be able
  // to inflate a count that WeChat will not honour.
  const accepted = Object.entries(parsed.data.granted)
    .filter(([key, state]) => state === "accept" && known.has(key))
    .map(([key]) => key);

  if (accepted.length > 0) {
    await grantQuota({
      miniProgramId: subscriber.miniProgramId,
      openId: subscriber.openId,
      templateKeys: accepted,
    });
  }

  return NextResponse.json({
    quota: await getQuota({
      miniProgramId: subscriber.miniProgramId,
      openId: subscriber.openId,
      templateKeys: [...known],
    }),
  });
}
