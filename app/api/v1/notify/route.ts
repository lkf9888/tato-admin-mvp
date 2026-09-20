import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { authenticateNotifyApp } from "@/lib/notify-hub/auth";
import { notify } from "@/lib/notify-hub/dispatch";

export const runtime = "nodejs";

/**
 * The one endpoint three systems call.
 *
 * TATO, HostHub and the wash bay each hold their own key, address
 * their own channels, and learn nothing about each other. None of them
 * knows a template id, an appid or a mini program path -- that is the
 * hub's half of the bargain, and what makes moving an app onto its own
 * mini program a row update rather than a release.
 */

const notifySchema = z.object({
  channel: z.string().trim().min(1).max(120),
  /** Supplying a name creates the channel on first use. */
  channelName: z.string().trim().min(1).max(80).optional(),
  template: z.string().trim().min(1).max(40),
  priority: z.enum(["high", "normal", "low"]).optional(),
  dedupeKey: z.string().trim().min(1).max(120).optional(),
  data: z.record(z.union([z.string().max(500), z.number(), z.null()])),
  link: z
    .object({
      url: z.string().url().max(500).optional(),
      path: z.string().trim().max(200).optional(),
    })
    .nullish(),
  expiresInDays: z.number().int().min(1).max(90).optional(),
});

export async function POST(request: NextRequest) {
  const app = await authenticateNotifyApp(request);
  if (!app) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  // Callers include a Python script on a car park machine and a
  // serverless function retrying through a flaky connection, so a
  // malformed body has to come back as a validation error rather than
  // a crash report.
  const parsed = notifySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "VALIDATION_ERROR", issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  try {
    const outcome = await notify(app, parsed.data);
    if (!outcome.ok) {
      const status = outcome.error === "TEMPLATE_NOT_FOUND" ? 400 : 404;
      return NextResponse.json({ error: outcome.error }, { status });
    }

    // 207: a channel with five subscribers can easily be three sends,
    // one out of quota and one muted, and collapsing that into a
    // single success or failure would hide exactly the thing a caller
    // needs in order to decide whether to fall back to email.
    const anyFailed = outcome.deliveries.some((delivery) => delivery.status !== "sent");
    return NextResponse.json(
      { channelId: outcome.channelId, deliveries: outcome.deliveries },
      { status: anyFailed && outcome.deliveries.length > 0 ? 207 : 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "NOTIFY_FAILED";
    // Configuration problems -- a mini program with no secret in the
    // environment -- are ours, not the caller's, and saying so stops
    // an integrator hunting through their own payload.
    const status = message.startsWith("MINI_PROGRAM_") ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
