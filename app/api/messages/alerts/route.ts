import { NextResponse } from "next/server";
import { z } from "zod";

import { requireCurrentAdminContext } from "@/lib/auth";
import {
  getGuestMessageAlertStatus,
  saveGuestMessageAlertSetting,
  sendGuestMessageAlertTest,
} from "@/lib/guest-message-push";

export const runtime = "nodejs";

/**
 * Pushing new guest messages to the operator's phone: the setting, its
 * WeChat channel and quota, and a test send. See lib/guest-message-push.
 */
export async function GET() {
  const { workspace } = await requireCurrentAdminContext();
  return NextResponse.json(await getGuestMessageAlertStatus(workspace.id));
}

const settingSchema = z.object({
  enabled: z.boolean(),
  smsPhone: z.string().trim().max(40).nullish(),
});

export async function PUT(request: Request) {
  const { workspace } = await requireCurrentAdminContext();
  const parsed = settingSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });

  const saved = await saveGuestMessageAlertSetting({
    workspaceId: workspace.id,
    enabled: parsed.data.enabled,
    smsPhone: parsed.data.smsPhone ?? null,
  });
  if (!saved.ok) return NextResponse.json({ error: saved.error }, { status: 400 });
  return NextResponse.json(await getGuestMessageAlertStatus(workspace.id));
}

/** Send one sample push through the same channels a real one uses. */
export async function POST() {
  const { workspace } = await requireCurrentAdminContext();
  return NextResponse.json(await sendGuestMessageAlertTest(workspace.id));
}
