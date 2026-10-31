import { NextResponse } from "next/server";
import { z } from "zod";

import { requireCurrentAdminContext } from "@/lib/auth";
import { isNotificationCategory } from "@/lib/notifications";
import {
  getPushPlusConfig,
  getPushPlusQueueStats,
  getPushPlusSetting,
  savePushPlusSetting,
  sendPushPlusTest,
} from "@/lib/pushplus";

export const runtime = "nodejs";

/**
 * WeChat notifications through PushPlus, for the settings page: GET the
 * state, PATCH the switch and categories, POST a test message. The token
 * and group code live in the environment and are never returned.
 */
async function context() {
  try {
    return await requireCurrentAdminContext();
  } catch {
    return null;
  }
}

async function status(workspaceId: string) {
  const config = getPushPlusConfig();
  const [setting, queue] = await Promise.all([getPushPlusSetting(workspaceId), getPushPlusQueueStats(workspaceId)]);
  return {
    configured: config.configured,
    group: Boolean(config.topic),
    enabled: setting.enabled,
    categories: setting.categories,
    lastSentAt: setting.lastSentAt?.toISOString() ?? null,
    lastError: setting.lastError,
    ...queue,
  };
}

export async function GET() {
  const ctx = await context();
  if (!ctx) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  return NextResponse.json(await status(ctx.workspace.id), { headers: { "Cache-Control": "no-store" } });
}

const patchSchema = z.object({
  enabled: z.boolean().optional(),
  categories: z.array(z.string()).max(20).optional(),
});

export async function PATCH(request: Request) {
  const ctx = await context();
  if (!ctx) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });
  await savePushPlusSetting(ctx.workspace.id, {
    enabled: parsed.data.enabled,
    categories: parsed.data.categories?.filter(isNotificationCategory),
  });
  return NextResponse.json(await status(ctx.workspace.id));
}

export async function POST() {
  const ctx = await context();
  if (!ctx) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const result = await sendPushPlusTest(ctx.workspace.id);
  return NextResponse.json({ ...result, status: await status(ctx.workspace.id) });
}
