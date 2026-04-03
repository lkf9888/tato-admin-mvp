import "server-only";

import bcrypt from "bcryptjs";
import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { prisma } from "@/lib/prisma";

const ADMIN_COOKIE = "turo-admin-session";
const SHARE_COOKIE_PREFIX = "turo-share-access-";

function getSecret() {
  return process.env.SESSION_SECRET ?? "local-dev-secret";
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

export async function requireAdminAuth() {
  const authenticated = await isAdminAuthenticated();
  if (!authenticated) {
    redirect("/login");
  }
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

export async function grantShareAccess(token: string) {
  const store = await cookies();
  store.set(`${SHARE_COOKIE_PREFIX}${token}`, createSignedPayload(token), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
}

export async function hasShareAccess(token: string) {
  const store = await cookies();
  return isSignedPayloadValid(store.get(`${SHARE_COOKIE_PREFIX}${token}`)?.value);
}
