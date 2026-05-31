import "server-only";

import { createHmac, timingSafeEqual } from "crypto";
import type { StaffMember } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  ensureStaffMiniProgramCode,
  ensureStaffShareToken,
  getBearerToken,
  listStaffMiniProgramTasks,
  normalizeStaffMiniProgramCode,
  serializeStaffMiniProgramStaff,
  staffMiniProgramTaskInclude,
} from "@/lib/staff-mini-program";

const STAFF_APP_SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

type StaffAppSessionPayload = {
  v: 1;
  channel: "staff-app";
  staffId: string;
  exp: number;
};

export type StaffAppSessionStaff = Pick<
  StaffMember,
  | "id"
  | "workspaceId"
  | "name"
  | "role"
  | "email"
  | "phone"
  | "color"
  | "pinnedMessage"
  | "shareToken"
  | "miniProgramCode"
  | "wechatOpenId"
  | "wechatNotificationEnabled"
>;

function getStaffAppSigningSecret() {
  const secret =
    process.env.STAFF_APP_SESSION_SECRET ||
    process.env.MINIPROGRAM_SESSION_SECRET ||
    process.env.SESSION_SECRET;
  if (secret && secret.length > 0) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("STAFF_APP_SESSION_SECRET or SESSION_SECRET must be set in production.");
  }
  return "local-dev-staff-app-secret";
}

function sign(value: string) {
  return createHmac("sha256", getStaffAppSigningSecret()).update(value).digest("base64url");
}

function createSignedToken(payload: StaffAppSessionPayload) {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

function decodeSignedToken(token: string): StaffAppSessionPayload | null {
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;

  const expected = sign(encoded);
  if (expected.length !== signature.length) return null;
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Partial<StaffAppSessionPayload>;
    if (
      payload.v !== 1 ||
      payload.channel !== "staff-app" ||
      !payload.staffId ||
      !payload.exp ||
      payload.exp < Math.floor(Date.now() / 1000)
    ) {
      return null;
    }
    return payload as StaffAppSessionPayload;
  } catch {
    return null;
  }
}

export function createStaffAppSession(staffId: string) {
  const now = Math.floor(Date.now() / 1000);
  return createSignedToken({
    v: 1,
    channel: "staff-app",
    staffId,
    exp: now + STAFF_APP_SESSION_TTL_SECONDS,
  });
}

export async function verifyStaffAppSession(token: string) {
  const payload = decodeSignedToken(token);
  if (!payload) return null;

  return prisma.staffMember.findFirst({
    where: {
      id: payload.staffId,
      isActive: true,
    },
    select: {
      id: true,
      workspaceId: true,
      name: true,
      role: true,
      email: true,
      phone: true,
      color: true,
      pinnedMessage: true,
      shareToken: true,
      miniProgramCode: true,
      wechatOpenId: true,
      wechatNotificationEnabled: true,
    },
  });
}

export async function findStaffByAppCode(staffCode: string) {
  const code = normalizeStaffMiniProgramCode(staffCode);
  if (!code) return null;

  const staff = await prisma.staffMember.findUnique({
    where: { miniProgramCode: code },
    select: {
      id: true,
      workspaceId: true,
      name: true,
      role: true,
      email: true,
      phone: true,
      color: true,
      pinnedMessage: true,
      shareToken: true,
      miniProgramCode: true,
      wechatOpenId: true,
      wechatNotificationEnabled: true,
      isActive: true,
    },
  });
  if (!staff || !staff.isActive) return null;
  const { isActive, ...activeStaff } = staff;
  return activeStaff;
}

export {
  ensureStaffMiniProgramCode,
  ensureStaffShareToken,
  getBearerToken,
  listStaffMiniProgramTasks,
  serializeStaffMiniProgramStaff,
  staffMiniProgramTaskInclude,
};
