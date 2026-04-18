import "server-only";

import bcrypt from "bcryptjs";
import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { prisma } from "@/lib/prisma";

const ADMIN_COOKIE = "turo-admin-session";
const SHARE_COOKIE_PREFIX = "turo-share-access-";

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (secret && secret.length > 0) return secret;

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "SESSION_SECRET must be set in production. Refusing to sign sessions with a development fallback.",
    );
  }

  return "local-dev-secret";
}

function signValue(value: string) {
  return createHmac("sha256", getSecret()).update(value).digest("hex");
}

function createSignedPayload(value: string) {
  return `${value}.${signValue(value)}`;
}

function isSignedPayloadValid(payload?: string) {
  if (!payload) return false;
  const [value, signature] = payload.split(".");
  if (!value || !signature) return false;

  const expected = signValue(value);
  if (signature.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

function getSignedPayloadValue(payload?: string) {
  if (!payload || !isSignedPayloadValid(payload)) return null;
  const [value] = payload.split(".");
  return value ?? null;
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export async function setAdminSession(value = "admin") {
  const store = await cookies();
  store.set(ADMIN_COOKIE, createSignedPayload(value), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 8,
  });
}

export async function clearAdminSession() {
  const store = await cookies();
  store.delete(ADMIN_COOKIE);
}

export async function isAdminAuthenticated() {
  const store = await cookies();
  return isSignedPayloadValid(store.get(ADMIN_COOKIE)?.value);
}

export async function getAdminSessionValue() {
  const store = await cookies();
  return getSignedPayloadValue(store.get(ADMIN_COOKIE)?.value);
}

export async function getCurrentAdminUser() {
  const sessionValue = await getAdminSessionValue();
  if (!sessionValue) return null;

  return prisma.user.findUnique({
    where: { id: sessionValue },
  });
}

export async function requireAdminAuth() {
  const authenticated = await isAdminAuthenticated();
  if (!authenticated) {
    redirect("/login");
  }
}

export async function requireCurrentAdminUser() {
  const user = await getCurrentAdminUser();
  if (!user) {
    redirect("/login");
  }
  return user;
}

export async function validateAdminCredentials(email: string, password: string) {
  const normalizedEmail = normalizeEmail(email);
  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  if (user && (await bcrypt.compare(password, user.passwordHash))) {
    return {
      sessionValue: user.id,
      user,
    };
  }

  return null;
}

function sharePasswordFingerprint(passwordHash: string) {
  return createHmac("sha256", getSecret())
    .update(`share-password:${passwordHash}`)
    .digest("hex")
    .slice(0, 32);
}

export async function grantShareAccess(token: string, passwordHash: string) {
  const store = await cookies();
  const fingerprint = sharePasswordFingerprint(passwordHash);
  store.set(`${SHARE_COOKIE_PREFIX}${token}`, createSignedPayload(fingerprint), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
}

export async function hasShareAccess(token: string, passwordHash: string) {
  const store = await cookies();
  const signed = store.get(`${SHARE_COOKIE_PREFIX}${token}`)?.value;
  const value = getSignedPayloadValue(signed);
  if (!value) return false;

  const expected = sharePasswordFingerprint(passwordHash);
  if (value.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(value), Buffer.from(expected));
}
