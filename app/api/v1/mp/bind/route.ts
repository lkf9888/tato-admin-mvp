import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { checkRateLimit, recordFailedAttempt } from "@/lib/rate-limit";
import { bindSubscriber, listSubscriberChannels } from "@/lib/notify-hub/channels";
import { authenticateSubscriber } from "@/lib/notify-hub/session";

export const runtime = "nodejs";

/**
 * Join a channel by typing its code.
 *
 * One person can hold several: a driver who also covers the wash bay
 * binds a TATO channel and a wash bay channel, and each system keeps
 * addressing its own without either learning the other exists.
 */

const bindSchema = z.object({
  bindCode: z.string().trim().min(4).max(32),
  /** Who this is, for the admin list. The hub has no directory. */
  label: z.string().trim().max(80).optional(),
});

export async function POST(request: NextRequest) {
  const subscriber = authenticateSubscriber(request);
  if (!subscriber) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  // Bind codes are eight characters from a 32-letter alphabet. That is
  // a large keyspace, but the endpoint hands out a subscription to
  // whoever guesses one, so it gets a bound -- keyed on the openid,
  // which is a real identity here rather than an IP shared by everyone
  // on the same depot wifi.
  const identifier = subscriber.openId;
  const decision = await checkRateLimit({
    scope: "notify_hub_bind",
    identifier,
    maxAttempts: 20,
    windowMs: 10 * 60 * 1000,
  });
  if (!decision.allowed) {
    return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
  }

  const parsed = bindSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });
  }

  const result = await bindSubscriber({
    miniProgramId: subscriber.miniProgramId,
    openId: subscriber.openId,
    bindCode: parsed.data.bindCode,
    label: parsed.data.label,
  });

  if (!result.ok) {
    await recordFailedAttempt({
      scope: "notify_hub_bind",
      identifier,
      windowMs: 10 * 60 * 1000,
    });
    // A code belonging to another mini program is reported as simply
    // not found. The person typing it cannot act on the difference,
    // and the difference tells a guesser which codes exist.
    return NextResponse.json({ error: "CHANNEL_NOT_FOUND" }, { status: 404 });
  }

  return NextResponse.json({
    channel: { id: result.channel.id, key: result.channel.key, name: result.channel.name },
    channels: await listSubscriberChannels({
      miniProgramId: subscriber.miniProgramId,
      openId: subscriber.openId,
    }),
  });
}
