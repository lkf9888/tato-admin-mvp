import "server-only";

import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { z } from "zod";

import { ASSIGNABLE_SECTIONS, type Role } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { normalizeEmail } from "@/lib/utils";

/**
 * A workspace's team: who is on it, inviting and adding people, changing
 * what they may open, removing them.
 *
 * Only the owner manages it, and the owner is never changed or removed
 * from here -- an account cannot lock its own owner out. A member is a
 * User row on the same workspace, so sign-in is unchanged; they inherit
 * the inviter's billing exemption, or an exempt account's members would
 * hit the vehicle limit the account itself is free of.
 */

const INVITE_DAYS = 7;

export const memberRoleSchema = z.enum(["ADMIN", "VIEWER"]);
export const pageAccessSchema = z
  .array(z.string())
  .transform((keys) => keys.filter((key) => ASSIGNABLE_SECTIONS.includes(key)));

export const newMemberSchema = z.object({
  email: z.string().trim().email(),
  name: z.string().trim().min(1).max(80),
  role: memberRoleSchema,
  pageAccess: pageAccessSchema,
  /** Set: the account is created now with this password. Absent: an invite is sent. */
  password: z.string().min(8).max(200).optional(),
});

/** Every page ticked is the same as "all", and is stored as null. */
function storePageAccess(keys: string[]) {
  const all = ASSIGNABLE_SECTIONS.every((key) => keys.includes(key));
  return all ? null : JSON.stringify(keys);
}

export async function emailInUse(email: string) {
  return Boolean(await prisma.user.findUnique({ where: { email: normalizeEmail(email) }, select: { id: true } }));
}

export async function listTeam(workspaceId: string) {
  const [members, invites] = await Promise.all([
    prisma.user.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, email: true, role: true, pageAccess: true, createdAt: true },
    }),
    prisma.userInvite.findMany({
      where: { workspaceId, acceptedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  return { members, invites };
}

export async function addMemberWithPassword(input: {
  workspaceId: string;
  inviter: { name: string; isBillingExempt: boolean };
  email: string;
  name: string;
  role: Exclude<Role, "OWNER">;
  pageAccess: string[];
  password: string;
}) {
  return prisma.user.create({
    data: {
      workspaceId: input.workspaceId,
      email: normalizeEmail(input.email),
      name: input.name,
      passwordHash: await bcrypt.hash(input.password, 10),
      role: input.role,
      pageAccess: storePageAccess(input.pageAccess),
      invitedBy: input.inviter.name,
      isBillingExempt: input.inviter.isBillingExempt,
    },
  });
}

export async function createInvite(input: {
  workspaceId: string;
  inviter: { name: string };
  email: string;
  name: string;
  role: Exclude<Role, "OWNER">;
  pageAccess: string[];
}) {
  const email = normalizeEmail(input.email);
  // One live invite per address: a second one replaces the first.
  await prisma.userInvite.deleteMany({ where: { workspaceId: input.workspaceId, email, acceptedAt: null } });
  return prisma.userInvite.create({
    data: {
      workspaceId: input.workspaceId,
      email,
      name: input.name,
      role: input.role,
      pageAccess: storePageAccess(input.pageAccess),
      token: randomBytes(32).toString("base64url"),
      expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000),
      createdBy: input.inviter.name,
    },
  });
}

/** A live invite by its token, with the workspace it is for; or null. */
export async function findOpenInvite(token: string) {
  if (!token || token.length < 20) return null;
  const invite = await prisma.userInvite.findUnique({ where: { token } });
  if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) return null;
  const workspace = await prisma.workspace.findUnique({ where: { id: invite.workspaceId }, select: { id: true, name: true } });
  return workspace ? { invite, workspace } : null;
}

/**
 * Accept an invite: the account is created on the inviting workspace
 * with the invite's role and pages. Fails if the address has meanwhile
 * become an account of its own.
 */
export async function acceptInvite(token: string, input: { name: string; password: string }) {
  const open = await findOpenInvite(token);
  if (!open) return { ok: false as const, reason: "INVITE_INVALID" };
  if (await emailInUse(open.invite.email)) return { ok: false as const, reason: "EMAIL_IN_USE" };
  const owner = await prisma.user.findFirst({
    where: { workspaceId: open.workspace.id, role: "OWNER" },
    select: { isBillingExempt: true },
  });
  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        workspaceId: open.workspace.id,
        email: open.invite.email,
        name: input.name,
        passwordHash: await bcrypt.hash(input.password, 10),
        role: open.invite.role,
        pageAccess: open.invite.pageAccess,
        invitedBy: open.invite.createdBy,
        isBillingExempt: owner?.isBillingExempt ?? false,
      },
    });
    await tx.userInvite.update({ where: { id: open.invite.id }, data: { acceptedAt: new Date() } });
    return created;
  });
  return { ok: true as const, user };
}

/** A member the owner may change: on this workspace, not an owner, not themselves. */
export async function findEditableMember(workspaceId: string, userId: string, actingUserId: string) {
  if (userId === actingUserId) return null;
  const member = await prisma.user.findFirst({ where: { id: userId, workspaceId } });
  if (!member || member.role === "OWNER") return null;
  return member;
}

export async function updateMember(userId: string, input: { role: Exclude<Role, "OWNER">; pageAccess: string[] }) {
  return prisma.user.update({
    where: { id: userId },
    data: { role: input.role, pageAccess: storePageAccess(input.pageAccess) },
  });
}
