import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";

import { sendDuePickupReminders } from "@/lib/direct-booking-reminders";

export const runtime = "nodejs";

/** The same shared secret the other scheduled scans present. */
function hasValidSecret(request: Request) {
  const secret = process.env.ALERT_SCAN_SECRET?.trim() || process.env.GMAIL_SYNC_SECRET?.trim();
  if (!secret) return false;
  const bearer = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const header = (request.headers.get("x-tato-sync-secret") ?? "").trim();
  const expected = Buffer.from(secret, "utf8");
  return [bearer, header].some((candidate) => {
    const supplied = Buffer.from(candidate, "utf8");
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  });
}

/**
 * Called every 15 minutes by `.github/workflows/booking-reminders.yml`:
 * reminds renters and operators of pick-ups in the next hour.
 */
export async function POST(request: Request) {
  if (!hasValidSecret(request)) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const result = await sendDuePickupReminders();
  return NextResponse.json({ ok: true, ...result });
}
