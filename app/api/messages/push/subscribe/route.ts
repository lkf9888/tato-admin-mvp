import { NextResponse } from "next/server";
import { z } from "zod";

import { requireCurrentAdminContext } from "@/lib/auth";
import { isNotificationCategory, type NotificationCategory } from "@/lib/notifications";
import { removeSubscription, saveSubscription, setSubscriptionCategories } from "@/lib/web-push";

export const runtime = "nodejs";

const subscribeSchema = z.object({
  subscription: z.object({
    endpoint: z.string().url().max(1000),
    keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
  }),
  label: z.string().trim().max(80).nullish(),
});

/**
 * This browser wants TATO's notifications (Web Push; see lib/web-push).
 * Also what the service worker calls when the browser rotates the
 * subscription.
 */
export async function POST(request: Request) {
  let context;
  try {
    context = await requireCurrentAdminContext();
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const parsed = subscribeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });
  await saveSubscription({
    workspaceId: context.workspace.id,
    userId: context.user.id,
    subscription: parsed.data.subscription,
    label: parsed.data.label ?? null,
  });
  return NextResponse.json({ ok: true });
}

/** Stop pushing to one browser: this one (`endpoint`) or one from the list (`id`). */
export async function DELETE(request: Request) {
  let context;
  try {
    context = await requireCurrentAdminContext();
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const parsed = z
    .object({ endpoint: z.string().max(1000).optional(), id: z.string().max(60).optional() })
    .refine((value) => value.endpoint || value.id)
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });
  await removeSubscription(context.workspace.id, parsed.data.endpoint ? { endpoint: parsed.data.endpoint } : { id: parsed.data.id });
  return NextResponse.json({ ok: true });
}

/** Choose which kinds of notification one device receives. */
export async function PATCH(request: Request) {
  let context;
  try {
    context = await requireCurrentAdminContext();
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const parsed = z
    .object({ id: z.string().min(1).max(60), categories: z.array(z.string().max(40)).max(20) })
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });
  const categories = parsed.data.categories.filter((value): value is NotificationCategory => isNotificationCategory(value));
  const found = await setSubscriptionCategories(context.workspace.id, parsed.data.id, categories);
  if (!found) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
