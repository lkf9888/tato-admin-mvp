import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { APP_VERSION } from "@/lib/version";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Liveness + readiness.
 *
 * This used to return a static JSON literal, which meant it reported
 * `ok` while the database was locked, read-only, or the volume was
 * full — exactly the failures that have actually taken this service
 * down. Railway routes traffic based on this endpoint, so a health
 * check that cannot fail is worse than none: it keeps sending users to
 * a container serving 500s on every page.
 *
 * `version` is here so "which build is live?" is answerable without
 * guessing. A Railway deploy that silently didn't pick up a push is
 * otherwise invisible until someone notices the fix isn't working.
 */
export async function GET() {
  const checks: Record<string, "ok" | "fail"> = {};
  let healthy = true;

  try {
    // Cheapest possible round-trip that proves the connection is live
    // and the file is readable.
    await prisma.$queryRaw`SELECT 1`;
    checks.database = "ok";
  } catch {
    checks.database = "fail";
    healthy = false;
  }

  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      service: "tato-admin-mvp",
      version: APP_VERSION,
      checks,
      timestamp: new Date().toISOString(),
    },
    { status: healthy ? 200 : 503 },
  );
}

export const HEAD = GET;
