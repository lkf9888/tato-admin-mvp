import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

import { listActiveAlerts, runAlertScan } from "@/lib/assistant-alerts";
import { getCurrentAdminUser, requireCurrentAdminContext } from "@/lib/auth";
import { sendAlertDigestEmail } from "@/lib/email";
import { prisma } from "@/lib/prisma";
import { getAppUrl } from "@/lib/stripe";
import { resolveTuroSyncWorkspace } from "@/lib/turo-sync";

export const runtime = "nodejs";

function hasValidScanSecret(request: Request) {
  const secret = process.env.ALERT_SCAN_SECRET?.trim() || process.env.GMAIL_SYNC_SECRET?.trim();
  if (!secret) return false;

  const bearer = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const headerSecret = (request.headers.get("x-tato-sync-secret") ?? "").trim();
  const expected = Buffer.from(secret, "utf8");

  return [bearer, headerSecret].some((candidate) => {
    const supplied = Buffer.from(candidate, "utf8");
    if (supplied.length !== expected.length) return false;
    return timingSafeEqual(supplied, expected);
  });
}

/** List currently-open alerts for the caller's workspace. */
export async function GET() {
  let context;
  try {
    context = await requireCurrentAdminContext();
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const alerts = await listActiveAlerts(context.workspace.id);
  return NextResponse.json({
    alerts: alerts.map((alert) => ({
      id: alert.id,
      severity: alert.severity,
      title: alert.title,
      body: alert.body,
      href: alert.href,
      acknowledged: alert.acknowledgedAt != null,
      createdAt: alert.createdAt.toISOString(),
      updatedAt: alert.updatedAt.toISOString(),
    })),
  });
}

/**
 * Run a scan.
 *
 * Callable by an admin session (the refresh button) or by a scheduler
 * presenting the shared secret. When `notify` is set, alerts that have
 * not yet been emailed are sent as one digest and marked notified — so
 * a scan running every ten minutes does not re-send the same alert.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { notify?: boolean };

  const user = await getCurrentAdminUser();
  let workspaceId: string | null = null;
  let isScheduled = false;

  if (user?.workspaceId) {
    workspaceId = user.workspaceId;
  } else if (hasValidScanSecret(request)) {
    const workspace = await resolveTuroSyncWorkspace();
    workspaceId = workspace.id;
    isScheduled = true;
  }

  if (!workspaceId) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const result = await runAlertScan(workspaceId);

  // Email only from scheduled runs by default. A person clicking
  // "refresh" is already looking at the list; emailing them what they
  // can see on screen is noise.
  const shouldNotify = body.notify ?? isScheduled;
  let notified = 0;

  if (shouldNotify) {
    const pending = await prisma.assistantAlert.findMany({
      where: {
        workspaceId,
        resolvedAt: null,
        notifiedAt: null,
        // INFO-level alerts stay in the UI and never generate email.
        // Interrupting someone's evening for "3 contracts unsigned" is
        // how a notification channel gets muted.
        severity: { in: ["WARNING", "CRITICAL"] },
      },
      orderBy: { severity: "desc" },
      take: 20,
    });

    if (pending.length > 0) {
      const recipients = await prisma.user.findMany({
        where: { workspaceId },
        select: { email: true, name: true },
      });

      for (const recipient of recipients) {
        const sent = await sendAlertDigestEmail({
          to: recipient.email,
          recipientName: recipient.name,
          appUrl: getAppUrl(),
          alerts: pending.map((alert) => ({
            severity: alert.severity,
            title: alert.title,
            body: alert.body,
            href: alert.href,
          })),
        });
        if (sent.ok) notified += 1;
      }

      // Mark notified only if at least one recipient actually received
      // it — otherwise a transient mail failure would permanently
      // suppress these alerts.
      if (notified > 0) {
        await prisma.assistantAlert.updateMany({
          where: { id: { in: pending.map((alert) => alert.id) } },
          data: { notifiedAt: new Date() },
        });
      }
    }
  }

  // eslint-disable-next-line no-console
  console.log(
    `[alert-scan] opened=${result.opened} updated=${result.updated} resolved=${result.resolved} active=${result.active} notifiedRecipients=${notified}`,
  );

  return NextResponse.json({ ...result, notifiedRecipients: notified });
}

const acknowledgeSchema = z.object({ alertId: z.string().min(1) });

/** Mark one alert as seen. It stays in the list, visually dimmed. */
export async function PATCH(request: Request) {
  let context;
  try {
    context = await requireCurrentAdminContext();
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const parsed = acknowledgeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });
  }

  const updated = await prisma.assistantAlert.updateMany({
    where: { id: parsed.data.alertId, workspaceId: context.workspace.id },
    data: { acknowledgedAt: new Date() },
  });

  if (updated.count === 0) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
