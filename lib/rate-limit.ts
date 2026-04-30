import "server-only";

import { headers } from "next/headers";

import { prisma } from "@/lib/prisma";

/**
 * Sliding-window rate limit primitive backed by the RateLimitAttempt
 * table. Failed attempts increment a counter inside a fixed-length
 * window; once the limit is hit the bucket stays locked until the
 * window expires (`retryAfterMs` is reported back to the caller).
 *
 * The shape is intentionally simple: one row per (scope, identifier),
 * no per-event log, no Redis. SQLite handles the volume fine for
 * brute-force protection where the legitimate path resets the row on
 * success.
 */

export type RateLimitConfig = {
  /** Stable bucket name. Pair an English noun with the surface, e.g.
   *  `login_email`, `login_ip`, `share_unlock`. */
  scope: string;
  /** Per-key value to bucket on, e.g. lowercased email, IP, token. */
  identifier: string;
  /** Failures before the bucket is locked. */
  maxAttempts: number;
  /** Length of the sliding window in milliseconds. */
  windowMs: number;
};

export type RateLimitDecision =
  | { allowed: true; remainingAttempts: number }
  | { allowed: false; retryAfterMs: number };

/**
 * Returns true when the caller is still inside the per-bucket budget.
 * Does NOT increment the counter — call `recordFailedAttempt` on a
 * failed action and `resetAttempts` on a successful one.
 */
export async function checkRateLimit(config: RateLimitConfig): Promise<RateLimitDecision> {
  const record = await prisma.rateLimitAttempt.findUnique({
    where: {
      scope_identifier: {
        scope: config.scope,
        identifier: config.identifier,
      },
    },
  });

  if (!record) {
    return { allowed: true, remainingAttempts: config.maxAttempts };
  }

  const windowEndedAt = record.windowStart.getTime() + config.windowMs;
  const now = Date.now();

  // Stale window — clean up so the next attempt starts fresh.
  if (windowEndedAt <= now) {
    await prisma.rateLimitAttempt.delete({
      where: {
        scope_identifier: {
          scope: config.scope,
          identifier: config.identifier,
        },
      },
    });
    return { allowed: true, remainingAttempts: config.maxAttempts };
  }

  if (record.attempts >= config.maxAttempts) {
    return { allowed: false, retryAfterMs: windowEndedAt - now };
  }

  return {
    allowed: true,
    remainingAttempts: Math.max(0, config.maxAttempts - record.attempts),
  };
}

/**
 * Record a failed attempt. Call AFTER the failed action so a hard
 * exception (validation, etc.) does not consume the budget.
 */
export async function recordFailedAttempt(config: Omit<RateLimitConfig, "maxAttempts">) {
  const now = new Date();
  const windowStartCutoff = new Date(now.getTime() - config.windowMs);

  await prisma.rateLimitAttempt.upsert({
    where: {
      scope_identifier: {
        scope: config.scope,
        identifier: config.identifier,
      },
    },
    update: {
      // If the existing window is still fresh, increment in place. If
      // it has aged past `windowMs`, restart the window from now.
      attempts: {
        increment: 1,
      },
      lastAttemptAt: now,
      // Refresh windowStart only when the previous one is stale. The
      // raw SQL would be a CASE, but Prisma's update API doesn't expose
      // that — use a guarded second update.
    },
    create: {
      scope: config.scope,
      identifier: config.identifier,
      attempts: 1,
      windowStart: now,
      lastAttemptAt: now,
    },
  });

  // Restart the window if the existing record is stale. Two-step
  // because SQLite-via-Prisma can't conditionally update a single
  // column based on the existing value in one statement.
  await prisma.rateLimitAttempt.updateMany({
    where: {
      scope: config.scope,
      identifier: config.identifier,
      windowStart: { lt: windowStartCutoff },
    },
    data: {
      attempts: 1,
      windowStart: now,
    },
  });
}

/**
 * Wipe the bucket — call on a successful login / unlock so a single
 * earlier mistype doesn't count against the user later.
 */
export async function resetAttempts(input: { scope: string; identifier: string }) {
  await prisma.rateLimitAttempt.deleteMany({
    where: { scope: input.scope, identifier: input.identifier },
  });
}

/**
 * Best-effort client IP. Trusts the closest reverse proxy via
 * `x-forwarded-for` / `x-real-ip`; falls back to the literal string
 * "unknown" so the bucket still locks on missing headers (better to
 * over-protect than under-protect).
 */
export async function getClientIp(): Promise<string> {
  const store = await headers();
  const forwarded = store.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = store.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "unknown";
}

export function formatRetryAfterSeconds(retryAfterMs: number): number {
  return Math.max(1, Math.ceil(retryAfterMs / 1000));
}
