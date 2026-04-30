import "server-only";

import bcrypt from "bcryptjs";

import { sendPasswordResetEmail, sendVerificationEmail } from "@/lib/email";
import type { Locale } from "@/lib/i18n";
import { prisma } from "@/lib/prisma";

const CODE_LENGTH = 6;
const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_ATTEMPTS = 5;
// Throttle: at most one new code per email per 30 seconds, regardless of
// purpose, to keep abusers from spamming SMTP.
const RESEND_COOLDOWN_MS = 30 * 1000;

export type VerificationPurpose = "registration" | "password_reset";

function generateCode(): string {
  // 6 random digits, zero-padded so leading zeros are preserved.
  const value = Math.floor(Math.random() * 1_000_000);
  return value.toString().padStart(CODE_LENGTH, "0");
}

function normalizeEmailAddress(email: string): string {
  return email.trim().toLowerCase();
}

export type IssueCodeResult =
  | { ok: true; sent: boolean; reason?: string }
  | { ok: false; reason: "throttled" | "invalid_email" };

export async function issueRegistrationCode(input: {
  email: string;
  locale: Locale;
}): Promise<IssueCodeResult> {
  const email = normalizeEmailAddress(input.email);
  if (!email || !email.includes("@")) {
    return { ok: false, reason: "invalid_email" };
  }

  // Throttle: one fresh code every RESEND_COOLDOWN_MS for the same email.
  const recent = await prisma.emailVerification.findFirst({
    where: {
      email,
      purpose: "registration",
      consumedAt: null,
    },
    orderBy: { createdAt: "desc" },
  });

  if (
    recent &&
    Date.now() - recent.createdAt.getTime() < RESEND_COOLDOWN_MS
  ) {
    return { ok: false, reason: "throttled" };
  }

  const code = generateCode();
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + CODE_TTL_MS);

  await prisma.emailVerification.create({
    data: {
      email,
      codeHash,
      purpose: "registration",
      expiresAt,
    },
  });

  // Best-effort send. If SMTP is not configured, the dev fallback in
  // `lib/email.ts` will log the code to the server console so registration
  // still works in local dev. The caller doesn't reveal email-existence
  // either way (we do that separately for the registration check).
  const sendResult = await sendVerificationEmail({
    to: email,
    code,
    locale: input.locale,
  });

  return { ok: true, sent: sendResult.ok, reason: sendResult.reason };
}

export type VerifyCodeResult =
  | { ok: true }
  | {
      ok: false;
      reason: "no_pending_code" | "expired" | "invalid_code" | "too_many_attempts";
    };

export async function verifyRegistrationCode(input: {
  email: string;
  code: string;
}): Promise<VerifyCodeResult> {
  const email = normalizeEmailAddress(input.email);
  const trimmedCode = input.code.trim();

  if (!email || !trimmedCode) {
    return { ok: false, reason: "no_pending_code" };
  }

  const record = await prisma.emailVerification.findFirst({
    where: {
      email,
      purpose: "registration",
      consumedAt: null,
    },
    orderBy: { createdAt: "desc" },
  });

  if (!record) {
    return { ok: false, reason: "no_pending_code" };
  }

  if (record.expiresAt.getTime() <= Date.now()) {
    return { ok: false, reason: "expired" };
  }

  if (record.attempts >= MAX_ATTEMPTS) {
    return { ok: false, reason: "too_many_attempts" };
  }

  const matches = await bcrypt.compare(trimmedCode, record.codeHash);

  if (!matches) {
    await prisma.emailVerification.update({
      where: { id: record.id },
      data: { attempts: record.attempts + 1 },
    });
    return { ok: false, reason: "invalid_code" };
  }

  await prisma.emailVerification.update({
    where: { id: record.id },
    data: {
      consumedAt: new Date(),
      attempts: record.attempts + 1,
    },
  });

  return { ok: true };
}

export async function issuePasswordResetCode(input: {
  email: string;
  locale: Locale;
}): Promise<IssueCodeResult> {
  const email = normalizeEmailAddress(input.email);
  if (!email || !email.includes("@")) {
    return { ok: false, reason: "invalid_email" };
  }

  // Throttle on the same purpose so password-reset spamming is bounded
  // independently from registration. We deliberately don't reveal
  // whether the email is registered — the throttling shape is the same
  // either way.
  const recent = await prisma.emailVerification.findFirst({
    where: {
      email,
      purpose: "password_reset",
      consumedAt: null,
    },
    orderBy: { createdAt: "desc" },
  });

  if (
    recent &&
    Date.now() - recent.createdAt.getTime() < RESEND_COOLDOWN_MS
  ) {
    return { ok: false, reason: "throttled" };
  }

  const code = generateCode();
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + CODE_TTL_MS);

  await prisma.emailVerification.create({
    data: {
      email,
      codeHash,
      purpose: "password_reset",
      expiresAt,
    },
  });

  // Only actually send the email when the account exists. We still
  // return ok:true above either way so the public form can't be used
  // to enumerate registered emails.
  const accountExists = await prisma.user.findUnique({ where: { email } });
  if (!accountExists) {
    return { ok: true, sent: false, reason: "no_account" };
  }

  const sendResult = await sendPasswordResetEmail({
    to: email,
    code,
    locale: input.locale,
  });

  return { ok: true, sent: sendResult.ok, reason: sendResult.reason };
}

export async function verifyPasswordResetCode(input: {
  email: string;
  code: string;
}): Promise<VerifyCodeResult> {
  const email = normalizeEmailAddress(input.email);
  const trimmedCode = input.code.trim();

  if (!email || !trimmedCode) {
    return { ok: false, reason: "no_pending_code" };
  }

  const record = await prisma.emailVerification.findFirst({
    where: {
      email,
      purpose: "password_reset",
      consumedAt: null,
    },
    orderBy: { createdAt: "desc" },
  });

  if (!record) {
    return { ok: false, reason: "no_pending_code" };
  }

  if (record.expiresAt.getTime() <= Date.now()) {
    return { ok: false, reason: "expired" };
  }

  if (record.attempts >= MAX_ATTEMPTS) {
    return { ok: false, reason: "too_many_attempts" };
  }

  const matches = await bcrypt.compare(trimmedCode, record.codeHash);

  if (!matches) {
    await prisma.emailVerification.update({
      where: { id: record.id },
      data: { attempts: record.attempts + 1 },
    });
    return { ok: false, reason: "invalid_code" };
  }

  await prisma.emailVerification.update({
    where: { id: record.id },
    data: {
      consumedAt: new Date(),
      attempts: record.attempts + 1,
    },
  });

  return { ok: true };
}

/**
 * Best-effort cleanup: callable from a cron / startup script if the table
 * grows. Removes consumed codes older than a day and expired unconsumed
 * codes older than the TTL window.
 */
export async function purgeStaleVerificationCodes() {
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const expiredBefore = new Date(Date.now() - CODE_TTL_MS);

  await prisma.emailVerification.deleteMany({
    where: {
      OR: [
        { consumedAt: { lt: dayAgo } },
        { expiresAt: { lt: expiredBefore }, consumedAt: null },
      ],
    },
  });
}
