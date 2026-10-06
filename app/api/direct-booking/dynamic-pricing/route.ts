import { NextResponse } from "next/server";
import { z } from "zod";

import { requireCurrentAdminContext } from "@/lib/auth";
import { logActivity } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import { parsePricingEvents } from "@/lib/vehicle-pricing-dynamic";
import {
  applyDynamicSuggestions,
  clearDynamicPrices,
  computeDynamicSuggestions,
  getDynamicPricingSettings,
} from "@/lib/vehicle-pricing-dynamic-run";

export const runtime = "nodejs";

const fraction = (min: number, max: number) => z.number().finite().min(min).max(max);

const settingsSchema = z.object({
  enabled: z.boolean(),
  autoApply: z.boolean(),
  horizonDays: z.number().int().min(7).max(365),
  minPct: fraction(0.3, 1),
  maxPct: fraction(1, 3),
  maxDailyChangePct: fraction(0.01, 1),
  weekendPct: fraction(-0.5, 1),
  holidayPct: fraction(-0.5, 1),
  lastMinuteDays: z.number().int().min(0).max(30),
  lastMinutePct: fraction(-0.5, 0.5),
  farOutDays: z.number().int().min(7).max(365),
  farOutPct: fraction(-0.5, 0.5),
  targetOccupancy: fraction(0, 1),
  occupancyStrength: fraction(0, 2),
  gapMaxDays: z.number().int().min(0).max(14),
  gapPct: fraction(-0.5, 0.5),
  events: z.array(z.object({ from: z.string(), to: z.string(), pct: z.number(), label: z.string().max(60) })).max(50),
  excludedVehicleIds: z.array(z.string()).max(500),
});

/** Save the settings. Turning dynamic pricing off takes its prices back off. */
export async function PATCH(request: Request) {
  const { workspace, user } = await requireCurrentAdminContext();
  const parsed = settingsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });
  const { events, excludedVehicleIds, ...rest } = parsed.data;
  const before = await getDynamicPricingSettings(workspace.id);
  await prisma.dynamicPricingSettings.update({
    where: { workspaceId: workspace.id },
    data: {
      ...rest,
      // Auto-apply means nothing while the whole thing is off.
      autoApply: rest.enabled && rest.autoApply,
      eventsJson: JSON.stringify(parsePricingEvents(JSON.stringify(events))),
      excludedVehicleIds: JSON.stringify(excludedVehicleIds),
    },
  });
  await logActivity({
    workspaceId: workspace.id,
    actor: user.name,
    action: "dynamic_pricing_settings_saved",
    entityType: "Workspace",
    entityId: workspace.id,
    metadata: parsed.data,
  });
  const cleared = before.enabled && !rest.enabled ? await clearDynamicPrices(workspace.id, user.name) : null;
  return NextResponse.json({ ok: true, cleared: cleared?.removed ?? 0 });
}

const actionSchema = z.object({
  action: z.enum(["compute", "apply", "clear"]),
  vehicleId: z.string().optional(),
});

export async function POST(request: Request) {
  const { workspace, user } = await requireCurrentAdminContext();
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });
  const settings = await getDynamicPricingSettings(workspace.id);
  if (parsed.data.action === "clear") {
    return NextResponse.json(await clearDynamicPrices(workspace.id, user.name));
  }
  if (!settings.enabled) return NextResponse.json({ error: "DISABLED" }, { status: 409 });
  if (parsed.data.action === "compute") {
    return NextResponse.json(await computeDynamicSuggestions(workspace.id));
  }
  return NextResponse.json(
    await applyDynamicSuggestions({ workspaceId: workspace.id, actor: user.name, vehicleId: parsed.data.vehicleId }),
  );
}
