import "server-only";

import bcrypt from "bcryptjs";
import { createHmac, timingSafeEqual } from "crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import {
  ACCESS_SECTIONS,
  canMakeRequest,
  canOpenPath,
  canUseSection,
  objectInPath,
  parseVehicleScope,
  userRole,
} from "@/lib/access";
import { prisma } from "@/lib/prisma";
import {
  ADMIN_COOKIE,
  ADMIN_SESSION_MAX_AGE_SECONDS,
  adminCookieOptions,
  SESSION_RENEWED_COOKIE,
} from "@/lib/session-cookie";
import { normalizeEmail } from "@/lib/utils";
import { ensureUserWorkspace } from "@/lib/workspaces";

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

export { normalizeEmail };

export async function setAdminSession(value = "admin") {
  const store = await cookies();
  store.set(ADMIN_COOKIE, createSignedPayload(value), adminCookieOptions(ADMIN_SESSION_MAX_AGE_SECONDS));
}

export async function clearAdminSession() {
  const store = await cookies();
  store.delete(ADMIN_COOKIE);
  store.delete(SESSION_RENEWED_COOKIE);
}

export async function isAdminAuthenticated() {
  const store = await cookies();
  return isSignedPayloadValid(store.get(ADMIN_COOKIE)?.value);
}

export async function getAdminSessionValue() {
  const store = await cookies();
  return getSignedPayloadValue(store.get(ADMIN_COOKIE)?.value);
}

/**
 * This request's path and method, as middleware stamped them. Null
 * outside a request (a script), where there is nothing to check.
 */
async function currentRequest() {
  try {
    const store = await headers();
    const path = store.get("x-tato-path");
    return path ? { path, method: store.get("x-tato-method") ?? "GET" } : null;
  } catch {
    return null;
  }
}

type SessionUser = { workspaceId: string | null; role: string; pageAccess: string | null; vehicleScope: string | null };

/** Whether this order or car is one of the member's cars. */
async function objectInScope(user: SessionUser, object: { kind: "order" | "vehicle"; id: string }, scope: string[]) {
  if (object.kind === "vehicle") return scope.includes(object.id);
  const order = await prisma.order.findFirst({
    where: { id: object.id, workspaceId: user.workspaceId ?? undefined },
    select: { vehicleId: true },
  });
  // An order that is not there is the route's 404 to give, not ours.
  return !order || scope.includes(order.vehicleId);
}

/**
 * Whether the signed-in member's role, pages and cars allow this request.
 *
 * A member limited to some cars is held to more: a path naming one order
 * or car must name one of theirs. Server actions are not refused here --
 * an action's POST re-renders the page it came from in the same request,
 * so refusing the POST would refuse that render too. Each action checks
 * itself instead: requireSectionContext refuses a car-limited member
 * unless the action says it filters to their cars (scopeAware).
 */
async function requestAllowed(user: SessionUser) {
  const request = await currentRequest();
  if (!request) return true;
  if (!canMakeRequest(user, request.path, request.method)) return false;
  const scope = userRole(user) === "OWNER" ? null : parseVehicleScope(user.vehicleScope);
  if (!scope) return true;
  const object = objectInPath(request.path);
  return !object || (await objectInScope(user, object, scope));
}

/**
 * The context for a server action, checked by what the action is -- not by
 * the page it was posted from, which a hand-made request can choose. An
 * action names the section it belongs to; one that filters to a member's
 * cars says so with `scopeAware`, and only those are open to members
 * limited to some cars. Viewers never get through: actions change things.
 */
export async function requireSectionContext(section: string, options: { scopeAware?: boolean } = {}) {
  const user = await loadSessionUser();
  if (!user?.workspaceId || !user.workspace) redirect("/login");
  const role = userRole(user);
  const scope = role === "OWNER" ? null : parseVehicleScope(user.vehicleScope);
  if (role === "VIEWER" || !canUseSection(user, section) || (scope && !options.scopeAware)) {
    throw new Error("ACCESS_DENIED");
  }
  return { user, workspace: user.workspace, vehicleIds: scope };
}

/**
 * The signed-in member with the cars they are limited to (null for the
 * whole fleet), for pages and routes that list cars, trips or files.
 */
export async function requireAccessContext() {
  const { user, workspace } = await requireCurrentAdminContext();
  const vehicleIds = userRole(user) === "OWNER" ? null : parseVehicleScope(user.vehicleScope);
  return { user, workspace, vehicleIds };
}

/** The first page a member may open: where a closed dashboard sends them. */
export function firstOpenPage(user: SessionUser) {
  return ACCESS_SECTIONS.find((section) => canOpenPath(user, section.key))?.key ?? "/account-settings";
}

/**
 * The signed-in admin, or null -- also null when their role or pages do
 * not cover this request, so every API route that answers a missing
 * user with 401 refuses a member who is not allowed there, unchanged.
 */
export async function getCurrentAdminUser() {
  const user = await loadSessionUser();
  if (!user) return null;
  return (await requestAllowed(user)) ? user : null;
}

async function loadSessionUser() {
  const sessionValue = await getAdminSessionValue();
  if (!sessionValue) return null;

  const user = await prisma.user.findUnique({
    where: { id: sessionValue },
    include: { workspace: true },
  });

  if (!user) return null;

  if (user.workspaceId && user.workspace) {
    return user;
  }

  const workspace = await ensureUserWorkspace(user.id);
  return prisma.user.findUnique({
    where: { id: sessionValue },
    include: { workspace: true },
  });
}

export async function requireAdminAuth() {
  const authenticated = await isAdminAuthenticated();
  if (!authenticated) {
    redirect("/login");
  }
}

export async function requireCurrentAdminUser() {
  const user = await loadSessionUser();
  if (!user) {
    redirect("/login");
  }
  if (!(await requestAllowed(user))) {
    // A page goes to a page that says so; an API call or server action
    // must fail rather than follow a redirect to HTML and look like it
    // worked.
    const request = await currentRequest();
    if (request?.path.startsWith("/api/") || (request && request.method !== "GET" && request.method !== "HEAD")) {
      throw new Error("ACCESS_DENIED");
    }
    // Sign-in lands on the dashboard; a member without it goes to the
    // first page they do have rather than to a refusal.
    if (request?.path === "/dashboard") redirect(firstOpenPage(user));
    redirect("/no-access");
  }
  return user;
}

/** The signed-in member without the per-request check: for the shell. */
export async function requireSessionUser() {
  const user = await loadSessionUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireCurrentWorkspace() {
  const user = await requireCurrentAdminUser();
  if (!user.workspaceId || !user.workspace) {
    redirect("/login");
  }

  return user.workspace;
}

export async function requireCurrentAdminContext() {
  const user = await requireCurrentAdminUser();
  if (!user.workspaceId || !user.workspace) {
    redirect("/login");
  }

  return {
    user,
    workspace: user.workspace,
  };
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
    secure: process.env.NODE_ENV === "production",
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
